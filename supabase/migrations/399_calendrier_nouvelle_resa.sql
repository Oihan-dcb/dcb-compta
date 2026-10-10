-- 399 — Calendrier PowerHouse, lot « nouvelle résa » (10/10/2026, validé par Oïhan)
--
-- Depuis le panneau de sélection du Calendrier (PowerHouse, 63-dispos-view.jsx → api/dispo-action.js) :
--   1. résa MANUELLE Hospitable (module partagé api/_resaManuelle.js, réutilisé par le futur « module direct ») ;
--   2. devis avec OPTION gérée CHEZ NOUS (create-quote Hospitable ne bloque rien et exige Direct) :
--      table devis_option + blocage Hospitable available:false avec la note
--      « Option devis — nom — jusqu'au JJ/MM HH:MM », libéré par api/cron-devis-options.js à l'échéance ;
--   3. bloquer / débloquer avec note ; 4. prix / séjour minimum (refusés par Hospitable quand PriceLabs
--      pilote le calendrier → bien.tarif_dynamique / min_sejour_dynamique mémorisent le refus) ;
--   5. séjours HORS Hospitable (HomeExchange, famille…) : table sejour_hors_hospitable + simple BLOCAGE
--      Hospitable avec la note « HomeExchange — nom » (jamais une résa manuelle : coût d'abonnement).
--
-- Toutes les écritures passent par api/dispo-action.js (service_role, rôle PowerHouse + périmètre du bien
-- vérifiés), journalisées dans dispo_action_log avec la requête Hospitable EXACTE envoyée.
-- Le hub Missions reconnaît les séjours hors Hospitable : un ménage en face n'est plus « sans séjour »
-- (mission_ecarts règle 2, mission_regles_simulation « en trop »).

-- ── 1. Journal : nouvelles actions + requête/réponse exactes ────────────────────────────────
alter table public.dispo_action_log drop constraint if exists dispo_action_log_action_check;
alter table public.dispo_action_log add constraint dispo_action_log_action_check check (action in (
  'block', 'unblock', 'set_rules', 'create_direct_reservation', 'create_manual_reservation',
  'devis_option', 'devis_prolonger', 'devis_annuler', 'devis_convertir', 'devis_expire',
  'sejour_hors_hospitable', 'sejour_hors_bloquer', 'sejour_hors_annuler', 'contrat_brouillon'));
alter table public.dispo_action_log add column if not exists requete jsonb;
alter table public.dispo_action_log add column if not exists reponse jsonb;
alter table public.dispo_action_log add column if not exists ref_id uuid;
comment on column public.dispo_action_log.requete is 'Requête(s) Hospitable exactes envoyées : [{method, path, body}] (399).';
comment on column public.dispo_action_log.reponse is 'Réponse Hospitable (tronquée) ou résultat de l''action (399).';
comment on column public.dispo_action_log.ref_id is 'devis_option.id ou sejour_hors_hospitable.id concerné (399).';
create index if not exists idx_dispo_action_log_ref on public.dispo_action_log(ref_id) where ref_id is not null;

-- Lecture : staff DANS SON PÉRIMÈTRE (le journal contient désormais nom / email du voyageur).
drop policy if exists dispo_action_log_read_staff on public.dispo_action_log;
drop policy if exists dispo_action_log_read_authenticated on public.dispo_action_log;
create policy dispo_action_log_read_staff on public.dispo_action_log for select to authenticated
  using (auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids())));

-- ── 2. Prix / séjour minimum pilotés par PriceLabs (refus Hospitable mémorisé) ───────────────
alter table public.bien add column if not exists tarif_dynamique boolean;
alter table public.bien add column if not exists min_sejour_dynamique boolean;
alter table public.bien add column if not exists tarif_dynamique_constate_le timestamptz;
comment on column public.bien.tarif_dynamique is 'true = Hospitable a refusé une modification de prix (tarification dynamique sortante, PriceLabs) : le Calendrier affiche « géré par PriceLabs ». NULL = inconnu (399).';
comment on column public.bien.min_sejour_dynamique is 'true = Hospitable a refusé une modification de séjour minimum (min stay dynamique, PriceLabs). NULL = inconnu (399).';

-- ── 3. Devis avec option ────────────────────────────────────────────────────────────────────
create table if not exists public.devis_option (
  id                 uuid primary key default gen_random_uuid(),
  bien_id            uuid not null references public.bien(id) on delete restrict,
  arrivee            date not null,
  depart             date not null,                       -- jour de départ (exclusif, comme reservation)
  adultes            int  not null default 1 check (adultes >= 1),
  enfants            int  not null default 0 check (enfants >= 0),
  voyageur_prenom    text not null,
  voyageur_nom       text not null,
  voyageur_email     text,
  voyageur_telephone text,
  langue             text not null default 'fr',
  lignes             jsonb not null default '[]'::jsonb,  -- [{cle, libelle, montant_centimes}]
  total_centimes     int  not null default 0,
  option_jusqu_au    timestamptz not null,
  note_blocage       text not null,                       -- note EXACTE posée sur les jours dans Hospitable
  statut             text not null default 'option' check (statut in ('option', 'converti', 'expire', 'annule', 'echec')),
  blocage            text not null default 'a_poser' check (blocage in ('a_poser', 'pose', 'echec', 'leve', 'leve_partiel')),
  jetons_jours       jsonb,                               -- jours réellement bloqués par NOUS (seuls ceux-là seront libérés)
  token              text not null unique default encode(extensions.gen_random_bytes(18), 'hex'),
  reservation_hospitable_id text,
  reservation_code   text,
  motif_fin          text,
  cree_par           uuid,
  cree_par_label     text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (depart > arrivee)
);
create index if not exists idx_devis_option_bien on public.devis_option(bien_id, arrivee);
create index if not exists idx_devis_option_echeance on public.devis_option(option_jusqu_au) where statut = 'option';
comment on table public.devis_option is 'Devis avec option (24 h / 72 h / 1 semaine, prolongeable) — option gérée chez nous + blocage Hospitable avec note ; libérée par api/cron-devis-options.js. Écriture : api/dispo-action.js (service_role) uniquement (399).';
comment on column public.devis_option.token is 'Jeton du lien voyageur /api/devis-voyageur?t=… (récapitulatif en lecture seule, rien n''est envoyé automatiquement).';

-- ── 4. Séjours hors Hospitable ──────────────────────────────────────────────────────────────
create table if not exists public.sejour_hors_hospitable (
  id                 uuid primary key default gen_random_uuid(),
  bien_id            uuid not null references public.bien(id) on delete restrict,
  date_debut         date not null,                       -- arrivée
  date_fin           date not null,                       -- jour de départ (exclusif)
  type               text not null check (type in ('homeexchange', 'famille', 'proprio', 'pret', 'autre')),
  nom                text not null,
  nb_personnes       int check (nb_personnes is null or nb_personnes >= 0),
  note               text,
  note_blocage       text not null,                       -- note EXACTE posée dans Hospitable
  blocage            text not null default 'a_poser' check (blocage in ('a_poser', 'pose', 'deja_bloque', 'partiel', 'echec', 'leve', 'leve_partiel')),
  jetons_jours       jsonb,                               -- jours réellement bloqués par NOUS
  menage_a_refacturer boolean not null default true,      -- ménage refacturé au propriétaire (forfait ménage proprio)
  annule_le          timestamptz,
  cree_par           uuid,
  cree_par_label     text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (date_fin > date_debut)
);
create index if not exists idx_sejour_hors_bien on public.sejour_hors_hospitable(bien_id, date_debut) where annule_le is null;
comment on table public.sejour_hors_hospitable is 'Séjours réels SANS résa Hospitable (HomeExchange, famille, prêt…) : saisis dans le Calendrier PowerHouse + simple blocage Hospitable avec note (une résa manuelle coûterait dans l''abonnement). Lus par le hub Missions (mission_ecarts, mission_regles_simulation) et l''alerte ménage orphelin (399).';

-- RLS : lecture staff dans son périmètre, écriture service_role (api/dispo-action.js) seulement.
alter table public.devis_option enable row level security;
alter table public.sejour_hors_hospitable enable row level security;
drop policy if exists devis_option_lecture_staff on public.devis_option;
create policy devis_option_lecture_staff on public.devis_option for select to authenticated
  using (auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids())));
drop policy if exists sejour_hors_lecture_staff on public.sejour_hors_hospitable;
create policy sejour_hors_lecture_staff on public.sejour_hors_hospitable for select to authenticated
  using (auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids())));
revoke insert, update, delete on public.devis_option, public.sejour_hors_hospitable from anon, authenticated;
revoke all on public.devis_option, public.sejour_hors_hospitable from anon;

-- ── 5. Création atomique : verrou par bien + contrôle de chevauchement ──────────────────────
-- Deux personnes qui posent une option / un séjour hors Hospitable sur les mêmes nuits au même moment :
-- un seul passe. Contrôle base (résas acceptées, options actives, séjours hors Hospitable) ; la
-- disponibilité Hospitable EN DIRECT est vérifiée par api/dispo-action.js juste avant.
create or replace function public.calendrier_creneau_conflits(p_bien uuid, p_debut date, p_fin date, p_ignorer_devis uuid default null)
returns jsonb language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(x), '[]'::jsonb) from (
    select 'reservation' as genre, r.code as ref, coalesce(nullif(trim(r.guest_name), ''), 'voyageur') as nom, r.arrival_date as debut, r.departure_date as fin
      from reservation r where r.bien_id = p_bien and r.final_status = 'accepted' and r.arrival_date < p_fin and r.departure_date > p_debut
    union all
    select 'devis_option', d.id::text, d.voyageur_prenom || ' ' || d.voyageur_nom, d.arrivee, d.depart
      from devis_option d where d.bien_id = p_bien and d.statut = 'option' and d.arrivee < p_fin and d.depart > p_debut
        and d.id is distinct from p_ignorer_devis
    union all
    select 'sejour_hors_hospitable', s.id::text, s.nom, s.date_debut, s.date_fin
      from sejour_hors_hospitable s where s.bien_id = p_bien and s.annule_le is null and s.date_debut < p_fin and s.date_fin > p_debut
  ) x
$$;

create or replace function public.devis_option_creer(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_bien uuid := (p->>'bien_id')::uuid; v_conf jsonb; v_row devis_option;
begin
  perform pg_advisory_xact_lock(hashtextextended('calendrier:' || v_bien::text, 0));
  v_conf := calendrier_creneau_conflits(v_bien, (p->>'arrivee')::date, (p->>'depart')::date);
  if jsonb_array_length(v_conf) > 0 then return jsonb_build_object('ok', false, 'conflits', v_conf); end if;
  insert into devis_option (bien_id, arrivee, depart, adultes, enfants, voyageur_prenom, voyageur_nom, voyageur_email,
    voyageur_telephone, langue, lignes, total_centimes, option_jusqu_au, note_blocage, cree_par, cree_par_label)
  values (v_bien, (p->>'arrivee')::date, (p->>'depart')::date, coalesce((p->>'adultes')::int, 1), coalesce((p->>'enfants')::int, 0),
    p->>'voyageur_prenom', p->>'voyageur_nom', nullif(p->>'voyageur_email', ''), nullif(p->>'voyageur_telephone', ''),
    coalesce(nullif(p->>'langue', ''), 'fr'), coalesce(p->'lignes', '[]'::jsonb), coalesce((p->>'total_centimes')::int, 0),
    (p->>'option_jusqu_au')::timestamptz, p->>'note_blocage', nullif(p->>'cree_par', '')::uuid, p->>'cree_par_label')
  returning * into v_row;
  return jsonb_build_object('ok', true, 'devis', to_jsonb(v_row));
end $$;

create or replace function public.sejour_hors_creer(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_bien uuid := (p->>'bien_id')::uuid; v_conf jsonb; v_row sejour_hors_hospitable;
begin
  perform pg_advisory_xact_lock(hashtextextended('calendrier:' || v_bien::text, 0));
  v_conf := calendrier_creneau_conflits(v_bien, (p->>'date_debut')::date, (p->>'date_fin')::date);
  if jsonb_array_length(v_conf) > 0 then return jsonb_build_object('ok', false, 'conflits', v_conf); end if;
  insert into sejour_hors_hospitable (bien_id, date_debut, date_fin, type, nom, nb_personnes, note, note_blocage,
    menage_a_refacturer, cree_par, cree_par_label)
  values (v_bien, (p->>'date_debut')::date, (p->>'date_fin')::date, p->>'type', p->>'nom', nullif(p->>'nb_personnes', '')::int,
    nullif(p->>'note', ''), p->>'note_blocage', coalesce((p->>'menage_a_refacturer')::boolean, true),
    nullif(p->>'cree_par', '')::uuid, p->>'cree_par_label')
  returning * into v_row;
  return jsonb_build_object('ok', true, 'sejour', to_jsonb(v_row));
end $$;

revoke all on function public.calendrier_creneau_conflits(uuid, date, date, uuid) from public, anon, authenticated;
revoke all on function public.devis_option_creer(jsonb) from public, anon, authenticated;
revoke all on function public.sejour_hors_creer(jsonb) from public, anon, authenticated;
grant execute on function public.calendrier_creneau_conflits(uuid, date, date, uuid) to service_role;
grant execute on function public.devis_option_creer(jsonb) to service_role;
grant execute on function public.sejour_hors_creer(jsonb) to service_role;

-- ── 6. Hub Missions : un ménage en face d'un séjour hors Hospitable n'est plus « sans séjour » ──
-- Modification CHIRURGICALE des fonctions en place (définitions issues de 392 / 395c) : on remplace un
-- fragment exact et on échoue bruyamment s'il n'est pas trouvé une et une seule fois.
do $mig$
declare d text; n int; a text; b text;
begin
  -- mission_ecarts, règle 2 (menage_sans_sejour)
  d := pg_get_functiondef('public.mission_ecarts(date,date)'::regprocedure);
  a := 'where not exists (select 1 from acc s where s.bien_id = x.bien_id and s.arrival_date <= x.d and s.departure_date >= x.d - 14)';
  n := (length(d) - length(replace(d, a, ''))) / length(a);
  if n <> 1 then raise exception 'mission_ecarts : fragment règle 2 trouvé % fois', n; end if;
  b := a || E'\n    and not exists (select 1 from sejour_hors_hospitable sh where sh.bien_id = x.bien_id and sh.annule_le is null and sh.date_debut <= x.d and sh.date_fin >= x.d - 14)';
  execute replace(d, a, b);

  -- mission_regles_simulation : statut « explique » au lieu de « en_trop »
  d := pg_get_functiondef('public.mission_regles_simulation(date,date,jsonb)'::regprocedure);
  a := 'when x.genre in (''technique'', ''recouche'', ''conciergerie'') then ''hors_regles''';
  n := (length(d) - length(replace(d, a, ''))) / length(a);
  if n <> 1 then raise exception 'mission_regles_simulation : fragment statut trouvé % fois', n; end if;
  b := a || E'\n              when x.genre = ''menage'' and exists (select 1 from sejour_hors_hospitable sh where sh.bien_id = x.bien_id and sh.annule_le is null and sh.date_debut <= x.d and sh.date_fin >= x.d - 14) then ''explique''';
  d := replace(d, a, b);
  -- … et la raison affichée
  a := 'case when exists (select 1 from _sim_sejour s where s.bien_id = x.bien_id and s.etudiant';
  n := (length(d) - length(replace(d, a, ''))) / length(a);
  if n <> 1 then raise exception 'mission_regles_simulation : fragment raison trouvé % fois', n; end if;
  b := 'case when exists (select 1 from sejour_hors_hospitable sh where sh.bien_id = x.bien_id and sh.annule_le is null and sh.date_debut <= x.d and sh.date_fin >= x.d - 14)'
    || E'\n                       then ''ménage d''''un séjour hors Hospitable : '' || (select string_agg(sh.note_blocage, '', '') from sejour_hors_hospitable sh where sh.bien_id = x.bien_id and sh.annule_le is null and sh.date_debut <= x.d and sh.date_fin >= x.d - 14)'
    || E'\n                     when exists (select 1 from _sim_sejour s where s.bien_id = x.bien_id and s.etudiant';
  execute replace(d, a, b);
end
$mig$;
