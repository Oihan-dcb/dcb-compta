-- 476 — Extras PRÉVUS par le bureau sur une mission (19/10/2026, demande Oïhan)
--
-- Besoin : sur une mission existante (ex. ménage de Claudine), le bureau ajoute un extra planifié (ménage poussé,
-- inventaire, autre) avec une durée prévue et des instructions. L'extra est OBLIGATOIREMENT fait par l'intervenant
-- de la mission : la table ne stocke AUCUN AE, il est lu sur mission_menage.ae_id (une réattribution emmène l'extra
-- avec la mission, aucune erreur d'AE possible). Il apparaît dans « Ma journée » sur cette mission comme un point à faire.
--
-- Pourquoi une table à part plutôt qu'une ligne prestation_hors_forfait « prevu » : une quinzaine de lectures
-- (PowerHouse, portail, compta : listes de paie, exportAutoDebours, compteurs…) filtrent seulement statut <> 'annule' ;
-- une ligne « prévue » y apparaîtrait comme un extra déclaré. Même modèle que l'entretien périodique (309) :
-- le PRÉVU vit à part, le FAIT crée la prestation_hors_forfait EN ATTENTE (circuit normal de validation bureau,
-- Gestion › Missions) et le lien est gardé (prestation_id).
--
-- Fait : RPC extra_prevu_fait (AE de la mission, mission EN COURS dans Ma journée) → prestation_hors_forfait
--   en_attente, type de prestation et imputation CHOISIS PAR LE BUREAU (l'AE ne peut pas les changer), durée réelle
--   saisie par l'AE, montant = même règle que le portail (prestationsTerrain.js / missionDuree.js : forfait du type,
--   sinon durée × taux horaire de l'AE, bien 01 = 20 €/h). Pendant la mission seulement : la règle forfait existante
--   (terrain_ajuster_extras_forfait, au « Terminer ») s'applique comme aux autres extras faits pendant la mission.
-- Pas fait : RPC extra_prevu_non_fait (motif obligatoire).
-- Contrôle (non bloquant) : un extra prévu ou « pas fait » sur une mission terminée = anomalie « extra prévu non
--   fait : … » dans mission_hub_periode → la mission passe dans « Vérifier » du hub (aucun blocage, ni paie ni AE).
-- Photos (structure seulement, l'outil viendra de l'audit inventaire / ménage de fond) : trois moments AVANT,
--   PENDANT, APRÈS, chacun avec un commentaire (colonnes commentaire_*) et des photos (mission_extra_prevu_photo).
-- Création / annulation par le bureau : uniquement via PowerHouse api/mission-hub (service_role, périmètre du
--   compte vérifié, journal mission_journal 'extra_prevu' / 'extra_prevu_annule').

-- ── 1. Type de prestation « Inventaire » (aucun dans le catalogue) ──────────────────────────────
-- Imputation par défaut PRUDENTE : dcb_direct (payé par DCB, jamais refacturé au propriétaire sans décision) ;
-- le bureau choisit une autre imputation à la création s'il y a lieu.
insert into public.prestation_type (nom, description, taux_defaut, unite, actif, type_imputation_defaut)
select 'Inventaire', 'Mise à jour de l''inventaire du logement (extra prévu par le bureau)', 2500, 'heure', true, 'dcb_direct'
where not exists (select 1 from public.prestation_type where lower(trim(nom)) = 'inventaire');

-- ── 2. Extras prévus ─────────────────────────────────────────────────────────────────────────
create table if not exists public.mission_extra_prevu (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.mission_menage(id) on delete cascade,
  genre text not null default 'autre' check (genre in ('menage_pousse', 'inventaire', 'autre')),
  prestation_type_id uuid not null references public.prestation_type(id),
  libelle text not null check (length(trim(libelle)) between 2 and 120),
  instructions text check (instructions is null or length(instructions) <= 2000),
  duree_prevue_minutes integer not null check (duree_prevue_minutes between 5 and 960),
  type_imputation text not null check (type_imputation in ('deduction_loy', 'dcb_direct', 'communs_provision')),
  statut text not null default 'prevu' check (statut in ('prevu', 'fait', 'non_fait', 'annule')),
  -- Réalisation (portail)
  prestation_id uuid references public.prestation_hors_forfait(id) on delete set null,
  duree_reelle_minutes integer check (duree_reelle_minutes is null or duree_reelle_minutes between 5 and 960),
  motif_non_fait text,
  fait_le timestamptz,
  fait_par_ae_id uuid references public.auto_entrepreneur(id) on delete set null,
  -- Photos : commentaire par moment (les photos elles-mêmes : mission_extra_prevu_photo)
  commentaire_avant text,
  commentaire_pendant text,
  commentaire_apres text,
  -- Bureau
  cree_par uuid,
  cree_par_nom text,
  annule_le timestamptz,
  annule_par_nom text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists mission_extra_prevu_mission_idx on public.mission_extra_prevu (mission_id);
create index if not exists mission_extra_prevu_ouverts_idx on public.mission_extra_prevu (mission_id) where statut in ('prevu', 'non_fait');
comment on table public.mission_extra_prevu is
  'Extras prévus par le bureau sur une mission (476). AE = celui de la mission (jamais stocké). Fait → prestation_hors_forfait en_attente (prestation_id). Prévu/pas fait sur mission terminée = anomalie du hub (Vérifier).';

alter table public.mission_extra_prevu enable row level security;
drop policy if exists mission_extra_prevu_select on public.mission_extra_prevu;
create policy mission_extra_prevu_select on public.mission_extra_prevu for select to authenticated using (
  auth_user_is_staff()
  or exists (select 1 from public.mission_menage m where m.id = mission_extra_prevu.mission_id and auth_user_owns_ae(m.ae_id))
);
-- Aucune écriture directe : bureau via api/mission-hub (service_role), AE via les RPC ci-dessous.
revoke insert, update, delete on public.mission_extra_prevu from anon, authenticated;

-- ── 3. Photos AVANT / PENDANT / APRÈS (structure pour l'outil photo à venir) ─────────────────
create table if not exists public.mission_extra_prevu_photo (
  id uuid primary key default gen_random_uuid(),
  extra_id uuid not null references public.mission_extra_prevu(id) on delete cascade,
  moment text not null check (moment in ('avant', 'pendant', 'apres')),
  url text not null,
  storage_path text,
  commentaire text,
  prise_le timestamptz,
  ae_id uuid references public.auto_entrepreneur(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists mission_extra_prevu_photo_extra_idx on public.mission_extra_prevu_photo (extra_id, moment);
comment on table public.mission_extra_prevu_photo is
  'Photos d''un extra prévu (476), par moment avant / pendant / après (commentaire du moment : mission_extra_prevu.commentaire_*). Structure prête pour l''outil photo (audit inventaire / ménage de fond).';
alter table public.mission_extra_prevu_photo enable row level security;
drop policy if exists mission_extra_prevu_photo_select on public.mission_extra_prevu_photo;
create policy mission_extra_prevu_photo_select on public.mission_extra_prevu_photo for select to authenticated using (
  auth_user_is_staff()
  or exists (select 1 from public.mission_extra_prevu x join public.mission_menage m on m.id = x.mission_id
              where x.id = mission_extra_prevu_photo.extra_id and auth_user_owns_ae(m.ae_id))
);
drop policy if exists mission_extra_prevu_photo_insert on public.mission_extra_prevu_photo;
create policy mission_extra_prevu_photo_insert on public.mission_extra_prevu_photo for insert to authenticated with check (
  auth_user_is_bureau()
  or exists (select 1 from public.mission_extra_prevu x join public.mission_menage m on m.id = x.mission_id
              where x.id = mission_extra_prevu_photo.extra_id and x.statut <> 'annule' and auth_user_owns_ae(m.ae_id))
);
revoke update, delete on public.mission_extra_prevu_photo from anon, authenticated;

-- ── 4. Journal : gestes du bureau ─────────────────────────────────────────────────────────────
alter table public.mission_journal drop constraint if exists mission_journal_type_check;
alter table public.mission_journal add constraint mission_journal_type_check check (type in (
  'verification', 'relance', 'reattribution', 'boucle_fait', 'boucle_non_faite', 'note', 'reglage',
  'ecart_ignore', 'extra_regle_hors_circuit', 'duree_validee', 'heure_changee', 'message_staff', 'date_changee', 'service_vendu',
  'extra_prevu', 'extra_prevu_annule'));

-- ── 5. Portail : « Fait » → prestation_hors_forfait en attente (circuit normal) ──────────────
create or replace function public.extra_prevu_fait(p_id uuid, p_duree_min integer, p_commentaire text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  x mission_extra_prevu; m mission_menage; t mission_terrain; a auto_entrepreneur; pt prestation_type;
  v_code text; v_duree int; v_taux int; v_montant int; v_presta uuid; v_desc text;
begin
  select * into x from mission_extra_prevu where id = p_id for update;
  if not found then raise exception 'extra_introuvable'; end if;
  m := _terrain_mission_check(x.mission_id);               -- l'appelant doit être l'AE de la mission
  if x.statut <> 'prevu' then raise exception 'extra_deja_traite'; end if;
  select * into t from mission_terrain where mission_id = m.id;
  if not found or t.started_at is null or t.ended_at is not null then raise exception 'mission_pas_en_cours'; end if;
  v_duree := round(coalesce(p_duree_min, 0) / 5.0) * 5;
  if v_duree < 5 or v_duree > 960 then raise exception 'duree_invalide'; end if;
  select * into a from auto_entrepreneur where id = m.ae_id;
  select * into pt from prestation_type where id = x.prestation_type_id;
  select code into v_code from bien where id = m.bien_id;
  -- Même règle que le portail (missionDuree.js tauxHoraireMission + prestationsTerrain.js creerExtraTerrain)
  v_taux := case when v_code = '01' then 2000 else coalesce(a.taux_horaire, 2500) end;
  v_montant := case when pt.unite = 'forfait' then coalesce(pt.taux_defaut, v_taux) else round(v_duree / 60.0 * v_taux) end;
  v_desc := 'Extra prévu par le bureau : ' || x.libelle || case when nullif(trim(p_commentaire), '') is not null then ' — ' || left(trim(p_commentaire), 300) else '' end;
  insert into prestation_hors_forfait (ae_id, mission_id, prestation_type_id, bien_id, date_prestation, duree_minutes, montant,
                                       type_imputation, description, statut, mois, reservation_id)
  values (m.ae_id, m.id, x.prestation_type_id, m.bien_id, m.date_mission, case when pt.unite = 'forfait' then null else v_duree end, v_montant,
          x.type_imputation, v_desc, 'en_attente', m.mois, null)
  returning id into v_presta;
  update mission_extra_prevu set statut = 'fait', prestation_id = v_presta, duree_reelle_minutes = v_duree, fait_le = now(), fait_par_ae_id = m.ae_id,
         commentaire_apres = coalesce(nullif(trim(p_commentaire), ''), commentaire_apres), updated_at = now()
   where id = x.id;
  return jsonb_build_object('prestation_id', v_presta, 'duree_minutes', v_duree, 'montant', v_montant);
end $$;
revoke all on function public.extra_prevu_fait(uuid, integer, text) from public, anon;
grant execute on function public.extra_prevu_fait(uuid, integer, text) to authenticated;

-- « Pas pu le faire » : motif obligatoire. Reste un point à vérifier pour le bureau (anomalie du hub).
create or replace function public.extra_prevu_non_fait(p_id uuid, p_motif text)
returns void language plpgsql security definer set search_path = public as $$
declare x mission_extra_prevu; m mission_menage;
begin
  select * into x from mission_extra_prevu where id = p_id for update;
  if not found then raise exception 'extra_introuvable'; end if;
  m := _terrain_mission_check(x.mission_id);
  if x.statut <> 'prevu' then raise exception 'extra_deja_traite'; end if;
  if length(trim(coalesce(p_motif, ''))) < 3 then raise exception 'motif_obligatoire'; end if;
  update mission_extra_prevu set statut = 'non_fait', motif_non_fait = left(trim(p_motif), 300), fait_le = now(), fait_par_ae_id = m.ae_id, updated_at = now()
   where id = x.id;
end $$;
revoke all on function public.extra_prevu_non_fait(uuid, text) from public, anon;
grant execute on function public.extra_prevu_non_fait(uuid, text) to authenticated;

-- ── 6. Hub : extra prévu non fait = anomalie (mission terminée) → « Vérifier » ────────────────
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
    -- 476 : extras PRÉVUS par le bureau (mission_extra_prevu) pas faits — « pas pu » compris, avec le motif
    (select string_agg(x.libelle || case when x.statut = 'non_fait' then ' (pas fait : ' || coalesce(nullif(trim(x.motif_non_fait), ''), 'sans motif') || ')' else '' end, ', ' order by x.created_at)
       from public.mission_extra_prevu x where x.mission_id = m.id and x.statut in ('prevu', 'non_fait')) as extras_prevus_non_faits,
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
      case when r.si_fin_oubliee and coalesce(base.start_declare, false) then 'démarrage déclaré après oubli' end,
      -- 476 : point de contrôle non bloquant, seulement une fois la mission finie (« Terminer » appuyé)
      case when base.ended_at is not null and base.extras_prevus_non_faits is not null then 'extra prévu non fait : ' || base.extras_prevus_non_faits end
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
  'Corps de mission_hub_v (382) avec fenêtre en paramètre (421) ; missions sans AE (recouche vendue, 425) ; extra prévu non fait = anomalie (476). mission_hub_v = fenêtre J-62 ; Metrics = période choisie. Modifier les règles ICI (une seule définition).';
revoke all on function public.mission_hub_periode(date, date, timestamptz) from public, anon, authenticated;
grant execute on function public.mission_hub_periode(date, date, timestamptz) to service_role;
