-- 425 — Services vendus en ligne (15/10/2026, décisions d'Oïhan) :
--  1. « Ménage en cours de séjour » / « Recouche » vendus en option → mission RECOUCHE créée AUTOMATIQUEMENT au milieu
--     du séjour (mission_menage type 'recouche', SANS AE : le bureau l'attribue depuis le hub Missions › À faire,
--     « Trouver un AE » ; aucune tâche Hospitable créée, aucune notification tant que personne n'est dessus).
--     Date = arrivée + floor(nuits × rang / (quantité + 1)) (milieu pour 1 recouche), JAMAIS le jour d'arrivée ni de départ ;
--     séjour < 3 nuits : option refusée à la vente (direct_service.nuits_min) et mission annulée si le séjour raccourcit.
--     Note visible « date décalable — à confirmer avec le voyageur » ; « Décaler » / « Date confirmée » dans le tiroir.
--     Idempotent : clé mission_menage.vente_source unique (devis + service + rang) — webhook rejoué = aucun doublon.
--     Suivi du séjour : trigger sur reservation (dates / statut) → mission déplacée (si date auto ou hors séjour),
--     annulée (séjour annulé / trop court), réactivée si le séjour revient ; jamais si démarrée ou validée.
--     La « recouche automatique » générale (Réglages du hub, 5 / 7 nuits) reste DÉSACTIVÉE.
--  2. Catalogue : délai minimum de commande par service (direct_service.delai_min_h, contrôlé par la page, le widget
--     ET le serveur), nuits minimum (nuits_min), type de mission créée (mission_type) ; prix « à définir » permis tant
--     que le service est désactivé ; ajout Recouche (ménage + linge) et Accueil VIP, désactivés, prix à définir.
--  Mission jamais rattachée à reservation_id (réservé au ménage de départ : ventilation / écarts) : lien par
--  vente_resa_hospitable_id = reservation.hospitable_id.

-- ─── Catalogue ──────────────────────────────────────────────────────────────────────────────────
alter table public.direct_service add column if not exists delai_min_h integer not null default 24 check (delai_min_h between 0 and 720);
alter table public.direct_service add column if not exists nuits_min integer check (nuits_min is null or nuits_min between 1 and 60);
alter table public.direct_service add column if not exists mission_type text check (mission_type is null or mission_type = 'recouche');
alter table public.direct_service drop constraint if exists direct_service_check;
alter table public.direct_service drop constraint if exists direct_service_prix_si_actif;
alter table public.direct_service add constraint direct_service_prix_si_actif check (type = 'demande' or prix_centimes is not null or not actif);
alter table public.direct_service drop constraint if exists direct_service_mission_service;
alter table public.direct_service add constraint direct_service_mission_service check (mission_type is null or type = 'service');
comment on column public.direct_service.delai_min_h is 'Délai minimum entre la commande et l''heure d''arrivée (h). Arrivée plus proche : service non proposé (page, widget) et refusé par le serveur.';
comment on column public.direct_service.nuits_min is 'Séjour minimum (nuits) pour proposer le service. Recouche : 3.';
comment on column public.direct_service.mission_type is '''recouche'' : une mission recouche est créée automatiquement au milieu du séjour (migration 425).';

update public.direct_service set delai_min_h = 24, maj_par = 'migration 425' where type in ('equipement', 'consommable', 'demande') and maj_par = 'migration 423';
update public.direct_service set mission_type = 'recouche', nuits_min = 3, delai_min_h = 48, maj_par = 'migration 425'
 where cle = 'menage_sejour';
insert into public.direct_service (agence, cle, type, nom, description, prix_centimes, unite, quantite_max, actif, ordre, delai_min_h, nuits_min, mission_type, maj_par) values
 ('dcb', 'recouche', 'service', 'Recouche (ménage + linge)', 'Ménage et changement du linge de lit et de toilette en milieu de séjour, à une date convenue avec vous.', null, 'par_sejour', 1, false, 62, 48, 3, 'recouche', 'migration 425'),
 ('dcb', 'accueil_vip', 'service', 'Accueil VIP', 'Accueil personnalisé et panier de bienvenue de produits locaux à votre arrivée.', null, 'par_sejour', 1, false, 65, 72, null, null, 'migration 425')
on conflict (agence, cle) do nothing;

-- ─── Missions vendues ───────────────────────────────────────────────────────────────────────────
alter table public.mission_menage add column if not exists vente_source text;
alter table public.mission_menage add column if not exists vente_resa_hospitable_id text;
alter table public.mission_menage add column if not exists vente_rang smallint;
alter table public.mission_menage add column if not exists vente_qte smallint;
alter table public.mission_menage add column if not exists vente_date_auto boolean;
alter table public.mission_menage add column if not exists vente_date_confirmee_le timestamptz;
alter table public.mission_menage add column if not exists vente_annulee_auto boolean not null default false;
create unique index if not exists mission_menage_vente_source_uk on public.mission_menage (vente_source) where vente_source is not null;
create index if not exists mission_menage_vente_resa_idx on public.mission_menage (vente_resa_hospitable_id) where vente_resa_hospitable_id is not null;
comment on column public.mission_menage.vente_source is 'Mission créée par un service vendu en ligne : devis:<id>:<service>:<rang> (unique = idempotence, 425).';

alter table public.mission_journal drop constraint if exists mission_journal_type_check;
alter table public.mission_journal add constraint mission_journal_type_check check (type = any (array['verification', 'relance', 'reattribution', 'boucle_fait',
  'boucle_non_faite', 'note', 'reglage', 'ecart_ignore', 'extra_regle_hors_circuit', 'duree_validee', 'heure_changee', 'message_staff',
  'date_changee', 'service_vendu']));

-- Date d'une recouche vendue : rang k sur q, séjour [arrivée, départ). Jamais le jour d'arrivée ni de départ.
create or replace function public.recouche_vendue_date(p_arrivee date, p_depart date, p_rang integer default 1, p_qte integer default 1)
returns date language sql immutable as $$
  select case when p_depart - p_arrivee < 2 then null
    else p_arrivee + greatest(1, least(p_depart - p_arrivee - 1, floor((p_depart - p_arrivee) * greatest(p_rang, 1)::numeric / (greatest(p_qte, 1) + 1))::int)) end
$$;

-- Création (service_role, api/_services.rattacher). Idempotent. Renvoie les missions (créées ou déjà là).
create or replace function public.recouche_vendue_creer(p_bien uuid, p_resa_hospitable_id text, p_arrivee date, p_depart date,
  p_source text, p_qte integer default 1, p_service text default 'Recouche', p_ref text default null)
returns table (mission_id uuid, date_mission date, cree boolean)
language plpgsql security definer set search_path to 'public' as $$
declare
  v_n int := p_depart - p_arrivee;
  v_q int := greatest(1, least(coalesce(p_qte, 1), 5));
  v_duree numeric;
  v_code text;
  v_d date;
  v_id uuid;
  k int;
begin
  if p_source is null or p_source !~ '^devis:[0-9a-f-]{36}:[a-z0-9_]{2,40}$' then raise exception 'source invalide'; end if;
  if v_n < 3 then raise exception 'sejour_trop_court'; end if;
  select b.code into v_code from bien b where b.id = p_bien;
  -- durée prévue = médiane des ménages de départ du bien sur 12 mois (repli 2 h)
  select percentile_cont(0.5) within group (order by m.duree_prevue) into v_duree
    from mission_menage m where m.bien_id = p_bien and m.type_mission = 'checkout' and m.duree_prevue > 0 and m.date_mission > current_date - 365;
  for k in 1..v_q loop
    v_d := recouche_vendue_date(p_arrivee, p_depart, k, v_q);
    insert into mission_menage (bien_id, date_mission, heure_mission, type_mission, statut, ae_id, titre_ical, duree_prevue, mois, note,
      vente_source, vente_resa_hospitable_id, vente_rang, vente_qte, vente_date_auto)
    values (p_bien, v_d, time '11:00', 'recouche', 'planifie', null,
      'Recouche vendue en ligne (' || coalesce(v_code, '?') || ')', coalesce(v_duree, 2), to_char(v_d, 'YYYY-MM'),
      left(p_service || ' vendu en ligne' || coalesce(' — ' || p_ref, '') || '. Date décalable — à confirmer avec le voyageur (séjour du '
        || to_char(p_arrivee, 'DD/MM/YYYY') || ' au ' || to_char(p_depart, 'DD/MM/YYYY') || ').', 500),
      p_source || ':' || k, p_resa_hospitable_id, k, v_q, true)
    on conflict (vente_source) where vente_source is not null do nothing
    returning id into v_id;
    if v_id is not null then
      insert into mission_journal (mission_id, bien_id, type, apres, texte, auteur_nom)
      values (v_id, p_bien, 'service_vendu', jsonb_build_object('date', v_d, 'source', p_source || ':' || k, 'resa', p_resa_hospitable_id),
        p_service || ' vendu en ligne : recouche créée le ' || to_char(v_d, 'DD/MM/YYYY') || ' (milieu du séjour, à confirmer avec le voyageur)', 'Vente en ligne');
      mission_id := v_id; date_mission := v_d; cree := true; return next;
    else
      select m.id, m.date_mission into mission_id, date_mission from mission_menage m where m.vente_source = p_source || ':' || k;
      cree := false; return next;
    end if;
    v_id := null;
  end loop;
  -- la résa existe peut-être déjà chez nous (webhook plus rapide) : aligner tout de suite
  perform recouche_vendue_suivre(p_resa_hospitable_id);
end $$;
revoke all on function public.recouche_vendue_creer(uuid, text, date, date, text, integer, text, text) from public, anon, authenticated;
grant execute on function public.recouche_vendue_creer(uuid, text, date, date, text, integer, text, text) to service_role;

-- Suivi du séjour : dates changées → mission déplacée ; annulé / trop court → annulée ; séjour revenu → réactivée.
create or replace function public.recouche_vendue_suivre(p_resa_hospitable_id text)
returns integer language plpgsql security definer set search_path to 'public' as $$
declare
  r record; m record;
  v_annule boolean; v_n int; v_cible date; n int := 0;
begin
  if p_resa_hospitable_id is null then return 0; end if;
  select x.arrival_date, x.departure_date, x.final_status into r from reservation x where x.hospitable_id = p_resa_hospitable_id limit 1;
  if not found then return 0; end if;
  v_annule := coalesce(r.final_status, '') ~ '^(cancelled|deleted|not accepted|checkpoint voided)';
  v_n := r.departure_date - r.arrival_date;
  for m in select mm.* from mission_menage mm
            where mm.vente_resa_hospitable_id = p_resa_hospitable_id and mm.vente_source is not null
              and coalesce(mm.statut, '') <> 'valide'
              and not exists (select 1 from mission_terrain t where t.mission_id = mm.id)
  loop
    if v_annule or v_n < 3 or m.vente_rang > v_n - 1 then
      if coalesce(m.statut, '') <> 'cancelled' then
        update mission_menage set statut = 'cancelled', vente_annulee_auto = true, updated_at = now() where id = m.id;
        insert into mission_journal (mission_id, bien_id, type, avant, apres, texte, auteur_nom)
        values (m.id, m.bien_id, 'service_vendu', jsonb_build_object('date', m.date_mission, 'statut', m.statut),
          jsonb_build_object('statut', 'cancelled', 'sejour', r.arrival_date || ' → ' || r.departure_date, 'final_status', r.final_status),
          case when v_annule then 'Séjour annulé : recouche vendue annulée' else 'Séjour raccourci à ' || v_n || ' nuit(s) : recouche vendue annulée (rembourser le service si besoin)' end, 'Suivi du séjour');
        n := n + 1;
      end if;
      continue;
    end if;
    v_cible := case when m.vente_date_auto or m.date_mission <= r.arrival_date or m.date_mission >= r.departure_date
                    then recouche_vendue_date(r.arrival_date, r.departure_date, m.vente_rang, m.vente_qte) else m.date_mission end;
    if m.statut = 'cancelled' and not m.vente_annulee_auto then continue; end if; -- annulée à la main : on n'y touche plus
    if v_cible is distinct from m.date_mission or m.statut = 'cancelled' then
      update mission_menage set date_mission = v_cible, mois = to_char(v_cible, 'YYYY-MM'),
        statut = case when statut = 'cancelled' then 'planifie' else statut end, vente_annulee_auto = false,
        vente_date_auto = case when m.vente_date_auto or m.date_mission <= r.arrival_date or m.date_mission >= r.departure_date then true else vente_date_auto end,
        vente_date_confirmee_le = case when v_cible is distinct from m.date_mission then null else vente_date_confirmee_le end,
        updated_at = now()
      where id = m.id;
      insert into mission_journal (mission_id, bien_id, type, avant, apres, texte, auteur_nom)
      values (m.id, m.bien_id, 'date_changee', jsonb_build_object('date', m.date_mission, 'statut', m.statut),
        jsonb_build_object('date', v_cible, 'sejour', r.arrival_date || ' → ' || r.departure_date),
        case when m.statut = 'cancelled' then 'Séjour de nouveau valide : recouche réactivée le ' else 'Dates du séjour changées : recouche déplacée au ' end
          || to_char(v_cible, 'DD/MM/YYYY') || ' (à confirmer avec le voyageur)', 'Suivi du séjour');
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke all on function public.recouche_vendue_suivre(text) from public, anon, authenticated;
grant execute on function public.recouche_vendue_suivre(text) to service_role;

create or replace function public.trg_recouche_vendue_suivre()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if tg_op = 'UPDATE' and old.arrival_date is not distinct from new.arrival_date and old.departure_date is not distinct from new.departure_date
     and old.final_status is not distinct from new.final_status then return new; end if;
  if new.hospitable_id is not null and exists (select 1 from mission_menage m where m.vente_resa_hospitable_id = new.hospitable_id) then
    perform recouche_vendue_suivre(new.hospitable_id);
  end if;
  return new;
exception when others then
  raise warning 'recouche_vendue_suivre(%) : %', new.hospitable_id, sqlerrm;
  return new;
end $$;
drop trigger if exists trg_recouche_vendue_suivre on public.reservation;
create trigger trg_recouche_vendue_suivre after insert or update of arrival_date, departure_date, final_status on public.reservation
  for each row execute function public.trg_recouche_vendue_suivre();

-- ─── Hub : une recouche vendue sans AE remonte dans « Trouver un AE » ─────────────────────────────
create or replace function public.mission_hub_periode(p_du date, p_au date default null, p_depuis timestamptz default null)
returns table (
  source text, mission_id uuid, task_id text, event_id text, bien_id uuid, bien_code text, bien_nom text, agence text, secteur text,
  ae_id uuid, ae_prenom text, ae_nom text, date_mission date, heure_mission time, debut timestamptz, prevu_min integer, type text,
  mission_statut text, acc_statut text, echeance_bureau timestamptz, acc_en_retard boolean, refus_motif text,
  t_statut text, started_at timestamptz, ended_at timestamptz, mesure_min integer, duree_declaree_minutes integer,
  video_media_id uuid, video_absente_motif text, controle_statut text, controle_note text, controle_at timestamptz,
  fin_oubliee boolean, par_bureau boolean, nb_tech integer, nb_sig integer, nb_besoins integer, nb_extras integer,
  derniere_relance timestamptz, non_faite boolean, hosp_statut text, hosp_teammate text,
  anomalies text[], toujours boolean, tiree boolean, a_verifier boolean, verif_echeance timestamptz,
  etapes text[], etat text, groupe text, pourquoi text, hors_paie boolean
)
language sql stable as $fn$
with
r as (select * from public.mission_verif_reglage where id = 1),
base as (
  select
    m.id as mission_id, m.ical_uid, m.bien_id, m.ae_id, m.date_mission, m.heure_mission, m.statut as mission_statut,
    m.type_mission, m.titre_ical, m.duree_prevue, m.reservation_id, m.vente_source, m.vente_date_confirmee_le,
    b.code as bien_code, b.hospitable_name as bien_nom, b.agence, b.secteur,
    a.prenom as ae_prenom, a.nom as ae_nom, a.ae_user_id,
    public.mission_debut(m.date_mission, m.heure_mission) as debut,
    case when m.ical_uid ~* '@smartbnb\.io$' then split_part(m.ical_uid, '@', 1) end as task_id,
    'ical_' || left(regexp_replace(coalesce(m.ical_uid, ''), '[^a-zA-Z0-9]', '', 'g'), 40) as event_id,
    round(coalesce(m.duree_prevue, 0) * 60)::int as prevu_min,
    ma.statut as acc_statut, ma.echeance_bureau, ma.refus_motif, ma.refus_precision, ma.traite_le as refus_traite_le,
    ma.notif_ae_le, ma.rappel_ae_le, ma.source as acc_source,
    t.statut as t_statut, t.started_at, t.ended_at, t.type_terrain, t.video_media_id, t.video_absente_motif,
    t.duree_declaree_minutes, coalesce(t.duree_corrigee_minutes, t.duree_minutes) as mesure_min,
    t.controle_statut, t.controle_note, t.controle_at, t.start_geo_statut, t.start_lat, t.fin_oubliee, t.start_declare,
    t.etat_arrivee,
    coalesce(t.declare_motif, '') like 'Marqué fait par le bureau%' as par_bureau,
    (select count(*) from public.tech_issues x where x.mission_id = m.id and x.status = 'signale')::int as nb_tech,
    (select count(*) from public.signalements x where x.mission_id = m.id and x.status = 'ouvert')::int as nb_sig,
    (select count(*) from public.tech_issues x where x.mission_id = m.id)::int
      + (select count(*) from public.signalements x where x.mission_id = m.id)::int as nb_signales,
    (select count(*) from public.besoin_sac x where x.mission_source_id = m.id and x.statut in ('a_preparer', 'dans_sac'))::int as nb_besoins,
    (select count(*) from public.prestation_hors_forfait x where x.mission_id = m.id and x.statut = 'en_attente')::int as nb_extras,
    (select max(j.created_at) from public.mission_journal j where j.mission_id = m.id and j.type = 'relance') as derniere_relance,
    exists (select 1 from public.mission_journal j where j.mission_id = m.id and j.type = 'boucle_non_faite') as non_faite,
    h.assignment_status as hosp_statut, h.teammate_nom as hosp_teammate
  from public.mission_menage m
  left join public.bien b on b.id = m.bien_id
  left join public.auto_entrepreneur a on a.id = m.ae_id
  left join public.mission_acceptation ma on ma.mission_id = m.id and ma.ae_id = m.ae_id
  left join public.mission_terrain t on t.mission_id = m.id
  left join public.hospitable_tache h on h.task_id = case when m.ical_uid ~* '@smartbnb\.io$' then split_part(m.ical_uid, '@', 1) end
  where m.date_mission >= p_du and (p_au is null or m.date_mission <= p_au)
    and coalesce(m.statut, '') not in ('cancelled', 'refuse')
),
calc as (
  select base.*,
    (now() at time zone 'Europe/Paris')::date as aujourdhui,
    (base.t_statut = 'terminee' and not base.par_bureau) as terminee_ae,
    -- anomalies (seulement une mission terminée dans Ma journée, pas marquée faite par le bureau)
    array_remove(array[
      case when r.si_depassement and base.prevu_min > 0 and base.mesure_min is not null and not coalesce(base.fin_oubliee, false)
                and base.mesure_min > base.prevu_min * (1 + r.depassement_pct / 100.0) and base.mesure_min - base.prevu_min >= 10
           then base.mesure_min || ' min pour ' || base.prevu_min || ' prévues (+' || round(100.0 * (base.mesure_min - base.prevu_min) / base.prevu_min) || ' %)' end,
      case when r.si_ecart_declare and base.duree_declaree_minutes is not null and base.mesure_min is not null and not coalesce(base.fin_oubliee, false)
                and abs(base.duree_declaree_minutes - base.mesure_min) > r.ecart_declare_min
           then base.duree_declaree_minutes || ' min déclarées, ' || base.mesure_min || ' au chrono' end,
      case when r.si_sans_video and base.video_media_id is null
           then 'pas de vidéo' || coalesce(' (' || case when length(base.video_absente_motif) > 60 then left(base.video_absente_motif, 57) || '…' else base.video_absente_motif end || ')', '') end,
      case when r.si_probleme and (base.nb_signales > 0 or base.etat_arrivee = 'probleme')
           then case when base.nb_signales > 0 then base.nb_signales || ' problème' || case when base.nb_signales > 1 then 's' else '' end || ' signalé' || case when base.nb_signales > 1 then 's' else '' end
                     else 'logement pas en état à l''arrivée' end end,
      case when r.si_position and base.start_lat is null and coalesce(base.start_geo_statut, '') <> 'ok'
           then case when base.start_geo_statut = 'refusee' then 'position refusée par l''AE' else 'position non relevée' end end,
      case when r.si_fin_oubliee and coalesce(base.fin_oubliee, false) then '« Terminer » oublié, durée déclarée après coup' end,
      case when r.si_fin_oubliee and coalesce(base.start_declare, false) then 'démarrage déclaré après oubli' end
    ], null) as anomalies,
    (base.ae_id = any(r.toujours_ae) or base.bien_id = any(r.toujours_biens)) as toujours,
    (r.echantillon_actif and ((hashtext(base.mission_id::text)::bigint % 100) + 100) % 100 < r.echantillon_pct) as tiree,
    least(
      coalesce(base.ended_at, base.debut) + make_interval(hours => r.delai_h),
      ((date_trunc('month', base.date_mission)::date + interval '1 month')::date + (r.jour_limite - 1) + time '23:59')::timestamp at time zone 'Europe/Paris'
    ) as verif_echeance,
    r.boucler_depuis,
    -- accueils jamais payants (Laura sur Lauïan, Léa sur Bordeaux…) : hors circuit paie
    (coalesce(base.type_mission = 'checkin' or base.type_terrain = 'check_in', false) and exists (
       select 1 from jsonb_array_elements(r.accueil_hors_paie) x
        where (x->>'ae_id')::uuid = base.ae_id
          and (x->>'agence' is null or x->>'agence' = base.agence)
          and (x->>'secteur' is null or x->>'secteur' = base.secteur))) as hors_paie
  from base cross join r
),
etat as (
  select calc.*,
    (calc.terminee_ae and not calc.hors_paie and (cardinality(calc.anomalies) > 0 or calc.toujours or calc.tiree)) as a_verifier,
    (calc.acc_statut = 'en_attente' and calc.echeance_bureau <= now()) as acc_en_retard,
    (calc.t_statut is null and not calc.hors_paie and coalesce(calc.mission_statut, '') <> 'valide' and not calc.non_faite
       and calc.date_mission >= calc.boucler_depuis
       and calc.debut + make_interval(mins => greatest(calc.prevu_min, 30)) + interval '2 hours' < now()) as jamais_demarree
  from calc
)
select
  'mission'::text as source,
  e.mission_id, e.task_id, e.event_id, e.bien_id, e.bien_code, e.bien_nom, e.agence, e.secteur,
  e.ae_id, e.ae_prenom, e.ae_nom, e.date_mission, e.heure_mission, e.debut, e.prevu_min,
  coalesce(e.type_terrain,
    case e.type_mission when 'checkout' then 'menage' when 'checkin' then 'check_in' when 'recouche' then 'recouche' else 'technique' end) as type,
  e.mission_statut, e.acc_statut, e.echeance_bureau, e.acc_en_retard, e.refus_motif,
  e.t_statut, e.started_at, e.ended_at, e.mesure_min, e.duree_declaree_minutes, e.video_media_id, e.video_absente_motif,
  e.controle_statut, e.controle_note, e.controle_at, e.fin_oubliee, e.par_bureau,
  e.nb_tech, e.nb_sig, e.nb_besoins, e.nb_extras, e.derniere_relance, e.non_faite,
  e.hosp_statut, e.hosp_teammate,
  e.anomalies, e.toujours, e.tiree, e.a_verifier, case when e.hors_paie then null else e.verif_echeance end as verif_echeance,
  -- les 5 cellules : f fait · c en attente · k bloque · v vérifiée · x pas besoin · '' à venir
  array[
    case when e.ae_id is null then 'k' else 'f' end,
    case when e.acc_statut = 'refusee' then 'k' when e.acc_statut = 'en_attente' then case when e.acc_en_retard then 'k' else 'c' end else 'f' end,
    case when e.t_statut = 'en_cours' then 'c' when e.t_statut is not null then 'f'
         when e.non_faite or e.jamais_demarree then 'k'
         when e.debut < now() and (coalesce(e.mission_statut, '') = 'valide' or e.hors_paie) then 'x' else '' end,
    case when e.t_statut = 'video_attendue' then case when e.date_mission < e.aujourdhui then 'k' else 'c' end
         when e.t_statut = 'terminee' then case when e.video_media_id is not null then 'f' else 'x' end else '' end,
    case when e.controle_statut = 'ok' then 'v' when e.controle_statut = 'a_reprendre' then 'k'
         when e.t_statut = 'terminee' then case when e.a_verifier then 'c' else 'x' end else '' end
  ] as etapes,
  case
    when e.ae_id is null and e.t_statut is null and coalesce(e.mission_statut, '') <> 'valide' then 'a_attribuer'
    when e.acc_statut = 'refusee' then 'refusee'
    when e.non_faite then 'non_faite'
    when e.t_statut is null and e.date_mission < e.aujourdhui and coalesce(e.mission_statut, '') = 'valide' then 'bouclee'
    when e.t_statut is null and e.hors_paie and e.debut < now() then 'hors_paie'
    when e.controle_statut = 'ok' then 'verifiee'
    when e.controle_statut = 'a_reprendre' then 'a_reprendre'
    when e.t_statut = 'terminee' then case when e.a_verifier then 'a_verifier' else 'bouclee' end
    when e.t_statut = 'video_attendue' then 'video_attendue'
    when e.t_statut = 'en_cours' then 'en_cours'
    when e.jamais_demarree then 'jamais_demarree'
    when e.acc_statut = 'en_attente' then 'en_attente'
    else 'acceptee'
  end as etat,
  case
    -- mission PowerHouse sans AE (recouche vendue en ligne, 425) : à attribuer par le bureau
    when e.ae_id is null and e.t_statut is null and e.date_mission >= e.aujourdhui then 'trouver_ae'
    when e.acc_statut = 'refusee' and e.refus_traite_le is null and e.date_mission >= e.aujourdhui then 'trouver_ae'
    -- en attente : seulement à l'approche de l'échéance (48 h avant), sinon la carte Semaine suffit
    when e.acc_statut = 'en_attente' and e.date_mission >= e.aujourdhui and e.echeance_bureau <= now() + interval '48 hours' then 'relancer'
    when e.t_statut in ('en_cours', 'video_attendue') and (e.date_mission < e.aujourdhui or coalesce(e.fin_oubliee, false)) then 'relancer'
    when e.t_statut = 'video_attendue' and e.ended_at < now() - interval '2 hours' then 'relancer'
    when e.jamais_demarree then 'boucler'
    when e.t_statut = 'terminee' and e.controle_statut is null and e.a_verifier then 'verifier'
  end as groupe,
  case
    when e.ae_id is null and e.t_statut is null and e.date_mission >= e.aujourdhui then
      case when e.vente_source is not null then 'Recouche vendue en ligne, personne n''est dessus. '
             || case when e.vente_date_confirmee_le is null then 'Date décalable — à confirmer avec le voyageur' else 'Date confirmée avec le voyageur' end
           else 'Personne n''est sur la mission' end
    when e.acc_statut = 'refusee' then coalesce(e.ae_prenom, 'L''AE') || ' a refusé' || coalesce(' (' || case e.refus_motif when 'indisponible' then 'indisponible' when 'horaire' then 'horaire' when 'trop_loin' then 'trop loin' when 'hospitable' then 'dans l''appli Hospitable' else e.refus_motif end || ')', '')
    when e.acc_statut = 'en_attente' and e.date_mission >= e.aujourdhui then
      case when e.acc_en_retard then 'Toujours pas acceptée, la réponse était attendue le ' || to_char(e.echeance_bureau at time zone 'Europe/Paris', 'DD/MM à HH24:MI')
           else 'Pas encore acceptée, réponse attendue avant le ' || to_char(e.echeance_bureau at time zone 'Europe/Paris', 'DD/MM à HH24:MI') end
    when e.t_statut = 'en_cours' and e.date_mission < e.aujourdhui then 'Démarrée le ' || to_char(e.started_at at time zone 'Europe/Paris', 'DD/MM à HH24:MI') || ', « Terminer » jamais appuyé : il manque la durée et la vidéo'
    when e.t_statut = 'video_attendue' and coalesce(e.fin_oubliee, false) then '« Terminer » oublié puis déclaré : il manque la vidéo'
    when e.t_statut = 'video_attendue' then 'Terminée le ' || to_char(e.ended_at at time zone 'Europe/Paris', 'DD/MM à HH24:MI') || ', vidéo pas encore envoyée'
    when e.jamais_demarree then 'Jamais démarrée dans Ma journée. A-t-elle eu lieu ?'
    when e.t_statut = 'terminee' and e.controle_statut is null and e.a_verifier then
      case when cardinality(e.anomalies) > 0 then upper(left(array_to_string(e.anomalies, ', '), 1)) || substr(array_to_string(e.anomalies, ', '), 2)
           when e.toujours then 'Toujours vérifiée (AE ou bien suivi de près), rien d''anormal'
           else 'Tirée au hasard, rien d''anormal' end
  end as pourquoi,
  e.hors_paie
from etat e

union all

-- Tâches Hospitable sans mission PowerHouse : non assignées, refusées dans l'appli, ou assignées à
-- quelqu'un dont l'iCal n'a pas encore produit la mission.
select
  'hospitable'::text, null::uuid, h.task_id, 'ical_' || left(regexp_replace(h.task_id || '@smartbnb.io', '[^a-zA-Z0-9]', '', 'g'), 40),
  h.bien_id, b.code, b.hospitable_name, b.agence, b.secteur,
  h.ae_id, coalesce(a.prenom, split_part(h.teammate_nom, ' ', 1)), a.nom,
  (h.debut at time zone 'Europe/Paris')::date, (h.debut at time zone 'Europe/Paris')::time, h.debut,
  round(coalesce(h.duree_h, extract(epoch from (h.fin - h.debut)) / 3600.0, 0) * 60)::int,
  coalesce(h.type_ph, 'menage'),
  null, null, null, false, null,
  null, null, null, null, null, null, null,
  null, null, null, null, false,
  0, 0, 0, 0, null, false,
  h.assignment_status, h.teammate_nom,
  '{}'::text[], false, false, false, null,
  array[case when h.teammate_id is null or h.assignment_status in ('rejected', 'unassigned') then 'k' else 'f' end,
        case when h.assignment_status = 'accepted' then 'f' when h.assignment_status = 'pending' then 'c' else '' end, '', '', ''],
  case when h.teammate_id is null or h.assignment_status = 'unassigned' then 'a_attribuer'
       when h.assignment_status = 'rejected' then 'refusee' else 'en_attente' end,
  case when (h.teammate_id is null or h.assignment_status in ('rejected', 'unassigned')) and h.debut >= now() then 'trouver_ae' end,
  case when h.teammate_id is null or h.assignment_status = 'unassigned' then 'Personne n''est sur la mission dans Hospitable'
       when h.assignment_status = 'rejected' then coalesce(split_part(h.teammate_nom, ' ', 1), 'L''AE') || ' a refusé dans l''appli Hospitable'
       else 'Assignée à ' || coalesce(h.teammate_nom, '?') || ' dans Hospitable, pas encore dans son agenda PowerHouse' end,
  false
from public.hospitable_tache h
left join public.bien b on b.id = h.bien_id
left join public.auto_entrepreneur a on a.id = h.ae_id
where h.disparu_le is null
  and coalesce(h.assignment_status, '') <> 'cancelled'
  and h.debut >= coalesce(p_depuis, (p_du::timestamp at time zone 'Europe/Paris'))
  and (p_au is null or (h.debut at time zone 'Europe/Paris')::date <= p_au)
  and not exists (select 1 from public.mission_menage m where m.ical_uid = h.task_id || '@smartbnb.io' and coalesce(m.statut, '') not in ('cancelled', 'refuse'))
$fn$;
comment on function public.mission_hub_periode(date, date, timestamptz) is
  'Corps de mission_hub_v (382) avec fenêtre en paramètre (421) ; missions sans AE (recouche vendue, 425). mission_hub_v = fenêtre J-62 ; Metrics = période choisie. Modifier les règles ICI (une seule définition).';
revoke all on function public.mission_hub_periode(date, date, timestamptz) from public, anon, authenticated;
grant execute on function public.mission_hub_periode(date, date, timestamptz) to service_role;

-- ─── Mission sans AE : seulement une recouche vendue en ligne (en attendant que le bureau l'attribue) ─────
-- (appliquée en 3 temps le 15/10/2026 : catalogue + missions, hub, puis cette contrainte)
alter table public.mission_menage alter column ae_id drop not null;
alter table public.mission_menage drop constraint if exists mission_menage_ae_ou_vente;
alter table public.mission_menage add constraint mission_menage_ae_ou_vente check (ae_id is not null or vente_source is not null);
comment on constraint mission_menage_ae_ou_vente on public.mission_menage is 'Seule une mission créée par un service vendu en ligne (recouche, 425) peut attendre son AE (à attribuer depuis le hub).';
