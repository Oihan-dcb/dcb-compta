-- 374 — « Mes missions » : l'AE accepte ou refuse ses missions dans le portail AE (09/10/2026).
--
-- Option 2 validée par Oïhan : RIEN n'est accepté sans l'AE, même en dernière minute.
--   • Une ligne par couple (mission, AE) : l'état « courant » d'une mission est la ligne de son AE actuel
--     (mission_menage.ae_id). Une réassignation (Hospitable → iCal → sync-ical-ae) crée naturellement une
--     nouvelle ligne « en attente » pour le nouvel AE ; l'historique du refus de l'ancien reste.
--   • Accepter : RPC mission_accepter (portail AE). Si l'AE a déjà accepté dans l'appli Hospitable
--     (task_assignment.status = accepted), le cron PowerHouse cron-missions-acceptation le reporte ici.
--   • Refuser / « Je ne peux plus » : RPC mission_refuser (appelée par api/mission-acceptation de PowerHouse
--     avec le JWT de l'AE), puis désassignation Hospitable (PATCH /v2/tasks/{id} teammate_uuid=null) et push
--     au bureau.
--   • Délais : mission normale → rappel push AE à +24 h, alerte bureau 48 h avant la mission ;
--     dernière minute (affectée < 24 h avant) → alerte bureau 2 h après l'affectation, ou 08:00 si affectée
--     la nuit (21:00-08:00, heure de Paris). Calcul : mission_acceptation_echeance().
--   • Reprise de l'existant : missions passées, du jour, ou déjà démarrées dans Ma journée → acceptées
--     (source 'reprise') pour ne bloquer ni le workflow terrain ni la paie. Missions à venir → en attente,
--     l'affectation étant datée du lancement (pas d'alerte bureau rétroactive).
--   • auto_entrepreneur.acceptation_missions : false pour les comptes bureau (acces_admin : Oïhan,
--     Clémence, Laura…) → leurs missions sont acceptées d'office (source 'non_requise').
-- Le Point du matin lira la vue missions_acceptation_a_signaler (aucun envoi ici).

-- ── Réglage par AE ──────────────────────────────────────────────────────
alter table public.auto_entrepreneur
  add column if not exists acceptation_missions boolean not null default true;
comment on column public.auto_entrepreneur.acceptation_missions is
  'Mes missions (migration 374) : true = l''AE doit accepter chaque mission dans le portail ; false = missions acceptées d''office (comptes bureau).';
update public.auto_entrepreneur set acceptation_missions = false where acces_admin and acceptation_missions;

-- ── Table ───────────────────────────────────────────────────────────────
create table if not exists public.mission_acceptation (
  id                        uuid primary key default gen_random_uuid(),
  mission_id                uuid not null references public.mission_menage(id) on delete cascade,
  ae_id                     uuid not null references public.auto_entrepreneur(id) on delete cascade,
  statut                    text not null default 'en_attente' check (statut in ('en_attente', 'acceptee', 'refusee')),
  source                    text check (source in ('portail', 'hospitable', 'reprise', 'non_requise', 'bureau')),
  assigne_le                timestamptz not null default now(),
  debut_mission             timestamptz,
  derniere_minute           boolean not null default false,
  echeance_bureau           timestamptz,
  accepte_le                timestamptz,
  refuse_le                 timestamptz,
  refus_motif               text check (refus_motif in ('indisponible', 'horaire', 'trop_loin', 'autre', 'hospitable')),
  refus_precision           text,
  refus_apres_acceptation   boolean not null default false,
  hospitable_desassigne_le  timestamptz,
  hospitable_erreur         text,
  hospitable_statut         text,
  hospitable_lu_le          timestamptz,
  notif_ae_le               timestamptz,
  rappel_ae_le              timestamptz,
  alerte_bureau_le          timestamptz,
  refus_notifie_le          timestamptz,
  traite_le                 timestamptz,
  traite_par                uuid,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  unique (mission_id, ae_id)
);
comment on table public.mission_acceptation is
  'Mes missions (migration 374) : acceptation / refus d''une mission par son AE. Ligne courante = (mission_id, mission_menage.ae_id). Écriture uniquement via RPC SECURITY DEFINER (mission_accepter, mission_refuser, mission_acceptation_traiter) et service_role (cron PowerHouse).';
create index if not exists mission_acceptation_ae_statut_idx on public.mission_acceptation (ae_id, statut);
create index if not exists mission_acceptation_attente_idx on public.mission_acceptation (echeance_bureau) where statut = 'en_attente';

alter table public.mission_acceptation enable row level security;
-- Lecture : quiconque voit la mission (RLS de mission_menage : bureau, AE propriétaire, managers scopés)
-- ET (c'est sa ligne, ou il est bureau / manager). Aucune écriture directe : RPC uniquement.
drop policy if exists mission_acceptation_select on public.mission_acceptation;
create policy mission_acceptation_select on public.mission_acceptation
  for select to authenticated
  using (
    exists (select 1 from public.mission_menage m where m.id = mission_acceptation.mission_id)
    and (
      public.auth_user_owns_ae(ae_id)
      or public.auth_user_is_bureau()
      or exists (select 1 from public.auto_entrepreneur a where a.ae_user_id = auth.uid() and a.actif and a.is_chat_manager)
    )
  );
revoke insert, update, delete on public.mission_acceptation from anon, authenticated;
grant select on public.mission_acceptation to authenticated;

-- ── Calculs ─────────────────────────────────────────────────────────────
-- Début de mission en heure de Paris (heure inconnue → 10:00, heure standard des ménages).
create or replace function public.mission_debut(p_date date, p_heure time)
returns timestamptz language sql immutable set search_path = public as $$
  select ((p_date + coalesce(p_heure, time '10:00'))::timestamp at time zone 'Europe/Paris');
$$;

-- Échéance de l'alerte bureau pour une mission affectée à p_assigne et commençant à p_debut.
--   délai court = +2 h, ou 08:00 (Paris) si l'affectation tombe entre 21:00 et 08:00 ;
--   dernière minute (< 24 h entre affectation et début) → délai court (sans dépasser le début) ;
--   sinon → 48 h avant la mission, jamais avant le délai court (affectée 30 h avant = délai court).
create or replace function public.mission_acceptation_echeance(p_assigne timestamptz, p_debut timestamptz)
returns timestamptz language plpgsql immutable set search_path = public as $$
declare
  v_local timestamp := p_assigne at time zone 'Europe/Paris';
  v_h int := extract(hour from v_local);
  v_court timestamptz;
begin
  if v_h >= 21 then
    v_court := ((v_local::date + 1) + time '08:00')::timestamp at time zone 'Europe/Paris';
  elsif v_h < 8 then
    v_court := (v_local::date + time '08:00')::timestamp at time zone 'Europe/Paris';
  else
    v_court := p_assigne + interval '2 hours';
  end if;
  if p_debut is null then return v_court; end if;
  if p_debut - p_assigne < interval '24 hours' then
    return least(v_court, greatest(p_debut, p_assigne));
  end if;
  return greatest(p_debut - interval '48 hours', v_court);
end $$;

-- ── Trigger : mission créée / réassignée / déplacée / réactivée ─────────
create or replace function public.mission_acceptation_sync()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Europe/Paris')::date;
  v_req boolean;
  v_debut timestamptz;
  r public.mission_acceptation%rowtype;
  v_nouvelle_affectation boolean := false;
begin
  if new.ae_id is null then return new; end if;
  if tg_op = 'UPDATE'
     and old.ae_id is not distinct from new.ae_id
     and old.date_mission is not distinct from new.date_mission
     and old.heure_mission is not distinct from new.heure_mission
     and old.statut is not distinct from new.statut then
    return new; -- upsert horaire de sync-ical-ae sans changement réel
  end if;

  v_debut := public.mission_debut(new.date_mission, new.heure_mission);
  select coalesce(a.acceptation_missions, true) into v_req from public.auto_entrepreneur a where a.id = new.ae_id;
  v_req := coalesce(v_req, true);
  select * into r from public.mission_acceptation where mission_id = new.id and ae_id = new.ae_id;

  if not found then
    if new.statut in ('cancelled', 'refuse') then return new; end if; -- ligne créée à la réactivation
    if new.date_mission < v_today then
      insert into public.mission_acceptation (mission_id, ae_id, statut, source, accepte_le, debut_mission)
      values (new.id, new.ae_id, 'acceptee', 'reprise', now(), v_debut) on conflict do nothing;
    elsif not v_req then
      insert into public.mission_acceptation (mission_id, ae_id, statut, source, accepte_le, debut_mission)
      values (new.id, new.ae_id, 'acceptee', 'non_requise', now(), v_debut) on conflict do nothing;
    else
      insert into public.mission_acceptation (mission_id, ae_id, statut, assigne_le, debut_mission, derniere_minute, echeance_bureau)
      values (new.id, new.ae_id, 'en_attente', now(), v_debut, (v_debut - now()) < interval '24 hours',
              public.mission_acceptation_echeance(now(), v_debut))
      on conflict do nothing;
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    -- Retour vers un AE qui avait déjà une ligne, ou mission réactivée après un refus, ou date changée
    -- sur une mission acceptée par l'AE : il faut une nouvelle acceptation (option 2).
    v_nouvelle_affectation :=
         (old.ae_id is distinct from new.ae_id)
      or (old.statut in ('cancelled', 'refuse') and new.statut not in ('cancelled', 'refuse') and r.statut = 'refusee')
      or (old.date_mission is distinct from new.date_mission and r.statut = 'acceptee' and r.source in ('portail', 'hospitable', 'bureau'));
    if v_nouvelle_affectation and new.statut not in ('cancelled', 'refuse') and new.date_mission >= v_today then
      if v_req then
        update public.mission_acceptation set
          statut = 'en_attente', source = null, assigne_le = now(), debut_mission = v_debut,
          derniere_minute = (v_debut - now()) < interval '24 hours',
          echeance_bureau = public.mission_acceptation_echeance(now(), v_debut),
          accepte_le = null, refuse_le = null, refus_motif = null, refus_precision = null, refus_apres_acceptation = false,
          hospitable_desassigne_le = null, hospitable_erreur = null, hospitable_statut = null,
          notif_ae_le = null, rappel_ae_le = null, alerte_bureau_le = null, refus_notifie_le = null,
          traite_le = null, traite_par = null, updated_at = now()
        where id = r.id;
      else
        update public.mission_acceptation set statut = 'acceptee', source = 'non_requise', accepte_le = now(),
          debut_mission = v_debut, refuse_le = null, refus_motif = null, refus_precision = null, updated_at = now()
        where id = r.id;
      end if;
    elsif r.statut = 'en_attente' and v_debut is distinct from r.debut_mission then
      -- Horaire déplacé sur une mission en attente : l'échéance suit (affectation inchangée).
      update public.mission_acceptation set debut_mission = v_debut,
        derniere_minute = (v_debut - r.assigne_le) < interval '24 hours',
        echeance_bureau = public.mission_acceptation_echeance(r.assigne_le, v_debut), updated_at = now()
      where id = r.id;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists mission_acceptation_sync on public.mission_menage;
create trigger mission_acceptation_sync
  after insert or update of ae_id, date_mission, heure_mission, statut on public.mission_menage
  for each row execute function public.mission_acceptation_sync();

-- ── RPC AE : accepter (une ou plusieurs missions) ───────────────────────
create or replace function public.mission_accepter(p_mission_ids uuid[])
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_n integer := 0;
  m record;
begin
  if auth.uid() is null then raise exception 'non_authentifie'; end if;
  for m in
    select mm.id, mm.ae_id, mm.date_mission, mm.heure_mission from public.mission_menage mm
    where mm.id = any(p_mission_ids) and mm.ae_id is not null
      and coalesce(mm.statut, '') not in ('cancelled', 'refuse')
      and public.auth_user_owns_ae(mm.ae_id)
  loop
    insert into public.mission_acceptation (mission_id, ae_id, statut, source, accepte_le, debut_mission)
    values (m.id, m.ae_id, 'acceptee', 'portail', now(), public.mission_debut(m.date_mission, m.heure_mission))
    on conflict (mission_id, ae_id) do update set statut = 'acceptee', source = 'portail', accepte_le = now(), updated_at = now()
      where public.mission_acceptation.statut = 'en_attente';
    if found then v_n := v_n + 1; end if;
  end loop;
  return v_n;
end $$;
revoke all on function public.mission_accepter(uuid[]) from public, anon;
grant execute on function public.mission_accepter(uuid[]) to authenticated;

-- ── RPC AE : refuser / « Je ne peux plus » ──────────────────────────────
-- Enregistre le refus et renvoie ce qu'il faut à api/mission-acceptation (PowerHouse) pour désassigner
-- la tâche Hospitable et prévenir le bureau. Interdit sur une mission passée ou déjà démarrée.
create or replace function public.mission_refuser(p_mission_id uuid, p_motif text, p_precision text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  m record;
  r public.mission_acceptation%rowtype;
  v_today date := (now() at time zone 'Europe/Paris')::date;
  v_apres boolean;
begin
  if auth.uid() is null then raise exception 'non_authentifie'; end if;
  if p_motif not in ('indisponible', 'horaire', 'trop_loin', 'autre') then raise exception 'motif_invalide'; end if;
  select mm.id, mm.ae_id, mm.date_mission, mm.heure_mission, mm.ical_uid, mm.titre_ical, mm.statut, mm.bien_id
    into m from public.mission_menage mm where mm.id = p_mission_id;
  if not found or m.ae_id is null or not public.auth_user_owns_ae(m.ae_id) then raise exception 'mission_introuvable'; end if;
  if coalesce(m.statut, '') in ('cancelled', 'refuse') then raise exception 'mission_annulee'; end if;
  if m.date_mission < v_today then raise exception 'mission_passee'; end if;
  if exists (select 1 from public.mission_terrain t where t.mission_id = m.id) then raise exception 'mission_demarree'; end if;

  select * into r from public.mission_acceptation where mission_id = m.id and ae_id = m.ae_id;
  if found and r.statut = 'refusee' then
    return jsonb_build_object('deja', true, 'acceptation_id', r.id, 'mission_id', m.id, 'ae_id', m.ae_id, 'ical_uid', m.ical_uid);
  end if;
  v_apres := found and r.statut = 'acceptee';

  insert into public.mission_acceptation (mission_id, ae_id, statut, refuse_le, refus_motif, refus_precision, refus_apres_acceptation, debut_mission)
  values (m.id, m.ae_id, 'refusee', now(), p_motif, nullif(trim(coalesce(p_precision, '')), ''), coalesce(v_apres, false),
          public.mission_debut(m.date_mission, m.heure_mission))
  on conflict (mission_id, ae_id) do update set statut = 'refusee', refuse_le = now(), refus_motif = excluded.refus_motif,
    refus_precision = excluded.refus_precision, refus_apres_acceptation = excluded.refus_apres_acceptation, updated_at = now()
  returning * into r;

  return jsonb_build_object('deja', false, 'acceptation_id', r.id, 'mission_id', m.id, 'ae_id', m.ae_id,
    'ical_uid', m.ical_uid, 'titre_ical', m.titre_ical, 'date_mission', m.date_mission, 'heure_mission', m.heure_mission,
    'bien_id', m.bien_id, 'apres_acceptation', r.refus_apres_acceptation);
end $$;
revoke all on function public.mission_refuser(uuid, text, text) from public, anon;
grant execute on function public.mission_refuser(uuid, text, text) to authenticated;

-- ── RPC bureau : refus traité (réattribué ailleurs, tâche supprimée…) ───
create or replace function public.mission_acceptation_traiter(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.auth_user_is_bureau() then raise exception 'reserve_bureau'; end if;
  update public.mission_acceptation set traite_le = now(), traite_par = auth.uid(), updated_at = now()
  where id = p_id and statut = 'refusee';
end $$;
revoke all on function public.mission_acceptation_traiter(uuid) from public, anon;
grant execute on function public.mission_acceptation_traiter(uuid) to authenticated;

-- ── Vue PowerHouse : état d'acceptation des missions (badges du Planning) ─
-- event_id = planning_events.id ('ical_' + uid nettoyé, 40 car.) — même clé que useTerrainDuJour.
-- etat : en_attente | en_retard (échéance bureau dépassée) | acceptee | refusee.
create or replace view public.mission_acceptation_etat with (security_invoker = true) as
select
  'ical_' || left(regexp_replace(m.ical_uid, '[^a-zA-Z0-9]', '', 'g'), 40) as event_id,
  m.id as mission_id, m.ae_id, a.prenom as ae_prenom, m.date_mission, m.heure_mission, m.statut as mission_statut,
  m.bien_id, b.code as bien_code, b.agence,
  ma.id as acceptation_id, ma.statut, ma.source,
  case when ma.statut = 'en_attente' and ma.echeance_bureau <= now() then 'en_retard' else ma.statut end as etat,
  ma.assigne_le, ma.accepte_le, ma.refuse_le, ma.refus_motif, ma.refus_precision, ma.refus_apres_acceptation,
  ma.derniere_minute, ma.echeance_bureau, ma.hospitable_desassigne_le, ma.hospitable_erreur, ma.traite_le
from public.mission_menage m
join public.mission_acceptation ma on ma.mission_id = m.id and ma.ae_id = m.ae_id
left join public.auto_entrepreneur a on a.id = m.ae_id
left join public.bien b on b.id = m.bien_id
where m.ical_uid is not null
  and m.date_mission >= ((now() at time zone 'Europe/Paris')::date - 1)
  and (coalesce(m.statut, '') not in ('cancelled', 'refuse') or ma.statut = 'refusee');
grant select on public.mission_acceptation_etat to authenticated;

-- ── Vue Point du matin : ce qu'il faut signaler au bureau ───────────────
-- categorie :
--   refus_a_reattribuer        : refusée par l'AE, mission toujours chez lui ou sans AE (pas encore réattribuée), non traitée
--   derniere_minute_en_retard  : affectée < 24 h avant, pas acceptée à l'échéance (2 h / 08:00)
--   en_attente_moins_48h       : pas acceptée, mission dans moins de 48 h
create or replace view public.missions_acceptation_a_signaler with (security_invoker = true) as
with base as (
  select m.id as mission_id, m.date_mission, m.heure_mission, m.titre_ical, m.statut as mission_statut,
         b.code as bien_code, b.hospitable_name as bien_nom, coalesce(b.agence, 'dcb') as agence,
         ma.ae_id, a.prenom as ae_prenom, ma.statut, ma.derniere_minute, ma.assigne_le, ma.echeance_bureau,
         ma.refuse_le, ma.refus_motif, ma.refus_precision, ma.refus_apres_acceptation, ma.hospitable_desassigne_le,
         ma.hospitable_erreur, ma.traite_le, ma.debut_mission, (m.ae_id = ma.ae_id) as courante
  from public.mission_acceptation ma
  join public.mission_menage m on m.id = ma.mission_id
  left join public.bien b on b.id = m.bien_id
  left join public.auto_entrepreneur a on a.id = ma.ae_id
  where m.date_mission >= (now() at time zone 'Europe/Paris')::date
)
select 'refus_a_reattribuer'::text as categorie, agence, mission_id, date_mission, heure_mission, titre_ical, bien_code, bien_nom,
       ae_prenom, statut, refuse_le as depuis, refus_motif, refus_precision, refus_apres_acceptation,
       (hospitable_desassigne_le is not null) as hospitable_desassignee, hospitable_erreur
from base
where statut = 'refusee' and courante and traite_le is null
union all
select case when derniere_minute then 'derniere_minute_en_retard' else 'en_attente_moins_48h' end, agence, mission_id, date_mission,
       heure_mission, titre_ical, bien_code, bien_nom, ae_prenom, statut, assigne_le, null, null, false, null, null
from base
where statut = 'en_attente' and courante and coalesce(mission_statut, '') not in ('cancelled', 'refuse')
  and (echeance_bureau <= now() or debut_mission <= now() + interval '48 hours');
comment on view public.missions_acceptation_a_signaler is
  'Mes missions (migration 374) — à lire par le Point du matin : refus à réattribuer, missions de dernière minute non acceptées, missions en attente à moins de 48 h. Une ligne par mission ; colonne agence pour le filtre par agence.';
grant select on public.missions_acceptation_a_signaler to authenticated;

-- ── Reprise de l'existant ───────────────────────────────────────────────
-- Passées, du jour, ou déjà démarrées → acceptées (ne rien bloquer). Comptes bureau → non_requise.
-- À venir → en attente, affectation datée du lancement.
insert into public.mission_acceptation (mission_id, ae_id, statut, source, accepte_le, assigne_le, debut_mission, derniere_minute, echeance_bureau)
select m.id, m.ae_id,
  case when m.date_mission <= (now() at time zone 'Europe/Paris')::date
         or exists (select 1 from public.mission_terrain t where t.mission_id = m.id)
         or not a.acceptation_missions then 'acceptee' else 'en_attente' end,
  case when m.date_mission <= (now() at time zone 'Europe/Paris')::date
         or exists (select 1 from public.mission_terrain t where t.mission_id = m.id) then 'reprise'
       when not a.acceptation_missions then 'non_requise' end,
  case when m.date_mission <= (now() at time zone 'Europe/Paris')::date
         or exists (select 1 from public.mission_terrain t where t.mission_id = m.id)
         or not a.acceptation_missions then now() end,
  now(),
  public.mission_debut(m.date_mission, m.heure_mission),
  (public.mission_debut(m.date_mission, m.heure_mission) - now()) < interval '24 hours',
  public.mission_acceptation_echeance(now(), public.mission_debut(m.date_mission, m.heure_mission))
from public.mission_menage m
join public.auto_entrepreneur a on a.id = m.ae_id
where coalesce(m.statut, '') not in ('cancelled', 'refuse')
on conflict (mission_id, ae_id) do nothing;

-- Retour arrière :
--   drop trigger if exists mission_acceptation_sync on public.mission_menage;
--   drop view if exists public.missions_acceptation_a_signaler, public.mission_acceptation_etat;
--   drop function if exists public.mission_acceptation_sync(), public.mission_accepter(uuid[]), public.mission_refuser(uuid, text, text),
--     public.mission_acceptation_traiter(uuid), public.mission_acceptation_echeance(timestamptz, timestamptz), public.mission_debut(date, time);
--   drop table if exists public.mission_acceptation; alter table public.auto_entrepreneur drop column if exists acceptation_missions;
