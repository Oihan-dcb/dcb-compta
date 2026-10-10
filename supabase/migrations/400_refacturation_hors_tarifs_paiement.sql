-- 400 — appliquée en 3 parties (400a / 400b / 400c) — Calendrier PowerHouse, suite du lot « nouvelle résa » (11/10/2026, décisions d'Oïhan)
--
-- 1. Séjours HORS Hospitable (HomeExchange, famille…) : refacturation du ménage AU CAS PAR CAS.
--    Plus aucune règle automatique : à la saisie (et dans « À faire » du hub quand le ménage arrive), la
--    question « Refacturer le ménage au propriétaire ? Oui (montant) / Non (motif) » est posée et
--    enregistrée sur le séjour. Tant que non répondu : rien n'est facturé, la question reste visible.
--    « Oui » = le séjour devient un SÉJOUR PROPRIÉTAIRE comptable (ligne `reservation` owner_stay,
--    platform manual, code HORS-xxxxxxxx, fin_revenue = montant) : ventilation FMEN/AUTO, facture
--    débours, rapport propriétaire, règle « séjour proprio annulé avant l'arrivée = sans frais »,
--    ménage annulé = sans frais (334/335) — exactement le mécanisme existant, rien de dupliqué.
-- 2. Fiche bien « Tarifs & frais / Disponibilité / Annulation » : table bien_tarification (une valeur par
--    clé × canal × source, priorité PowerHouse > Hospitable > historique des résas).
-- 3. Choix du paiement d'une résa manuelle (mode + répartition + date du solde + caution + annulation) :
--    table resa_paiement_choix, lue par la création du contrat à la place de la règle par canal.

-- ═══ 1. Séjours hors Hospitable : refacturation au cas par cas ═══════════════════════════════════
alter table public.sejour_hors_hospitable alter column menage_a_refacturer drop default;
alter table public.sejour_hors_hospitable alter column menage_a_refacturer drop not null;
-- La valeur par défaut « true » de 399 n'était pas une décision : on repart de « non répondu ».
alter table public.sejour_hors_hospitable add column if not exists refacturer_montant_centimes int
  check (refacturer_montant_centimes is null or refacturer_montant_centimes > 0);
alter table public.sejour_hors_hospitable add column if not exists refacturer_motif text;
alter table public.sejour_hors_hospitable add column if not exists refacturer_repondu_le timestamptz;
alter table public.sejour_hors_hospitable add column if not exists refacturer_repondu_par text;
update public.sejour_hors_hospitable set menage_a_refacturer = null where refacturer_repondu_le is null;
comment on column public.sejour_hors_hospitable.menage_a_refacturer is
  'NULL = question pas encore répondue (rien n''est facturé, question visible dans le Calendrier et « À faire » du hub) ; true = ménage refacturé au propriétaire (refacturer_montant_centimes, via une ligne reservation owner_stay HORS-…) ; false = non refacturé (refacturer_motif). Migration 400.';

alter table public.reservation add column if not exists sejour_hors_id uuid unique
  references public.sejour_hors_hospitable(id) on delete restrict;
comment on column public.reservation.sejour_hors_id is
  'Ligne SYNTHÉTIQUE d''un séjour hors Hospitable dont le ménage est refacturé (400) : owner_stay, platform manual, code HORS-…, hospitable_id NULL, reservation_status NULL. Maintenue par sejour_hors_sync_reservation, jamais à la main.';

-- Maintient la ligne reservation d'un séjour hors Hospitable (idempotent).
create or replace function public.sejour_hors_sync_reservation(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  s sejour_hors_hospitable; v_bien bien; v_resa reservation; v_heure text; v_checkin timestamptz;
  v_actif boolean; v_montant int; v_statut text; v_lib text; v_mois text;
begin
  select * into s from sejour_hors_hospitable where id = p_id;
  if s.id is null then return; end if;
  select * into v_bien from bien where id = s.bien_id;
  select * into v_resa from reservation where sejour_hors_id = p_id;
  v_heure := case when v_bien.heure_arrivee_defaut ~ '^\d{1,2}:\d{2}$' then v_bien.heure_arrivee_defaut else '16:00' end;
  v_checkin := ((s.date_debut::text || ' ' || v_heure)::timestamp at time zone 'Europe/Paris');
  -- Facturé : réponse « Oui » et séjour non annulé — ou annulé à l'arrivée / après (le ménage a pu être
  -- fait : forfait conservé, même règle que les séjours propriétaire Hospitable, 24/09/2026).
  v_actif := s.menage_a_refacturer is true and (s.annule_le is null or s.annule_le >= v_checkin);
  if not v_actif and v_resa.id is null then return; end if;
  v_montant := case when v_actif then s.refacturer_montant_centimes else 0 end;
  v_statut := case when v_actif then 'accepted' else 'cancelled' end;
  v_lib := case s.type when 'homeexchange' then 'HomeExchange' when 'famille' then 'Famille' when 'proprio' then 'Séjour propriétaire'
                       when 'pret' then 'Prêt' else 'Hors Hospitable' end || ' — ' || s.nom;
  v_mois := to_char(s.date_debut, 'YYYY-MM');
  -- Mois clôturé pour ce bien (verrou de saisie, facture envoyée) : on refuse plutôt que de modifier en silence.
  if exists (select 1 from cloture_bien c where c.bien_id = s.bien_id and c.active
              and c.mois in (v_mois, coalesce(v_resa.mois_comptable, v_mois)))
     and (v_resa.id is null or v_resa.fin_revenue is distinct from v_montant or v_resa.final_status is distinct from v_statut
          or v_resa.arrival_date <> s.date_debut or v_resa.departure_date <> s.date_fin) then
    raise exception 'mois_cloture: % est clôturé pour ce bien — réouverture nécessaire avant de changer la refacturation', v_mois;
  end if;
  if v_resa.id is null then
    insert into reservation (bien_id, hospitable_id, code, platform, arrival_date, departure_date, nights, checkin_time,
      guest_name, guest_count, stay_type, owner_stay, reservation_status, final_status, fin_accommodation, fin_revenue,
      fin_currency, mois_comptable, ventilation_calculee, rapprochee, sejour_hors_id, synced_at)
    values (s.bien_id, null, 'HORS-' || upper(substr(replace(s.id::text, '-', ''), 1, 8)), 'manual', s.date_debut, s.date_fin,
      s.date_fin - s.date_debut, to_char(v_checkin at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      v_lib, s.nb_personnes, 'owner_stay', true, null, v_statut, v_montant, v_montant,
      'EUR', v_mois, false, false, s.id, now());
  elsif v_resa.fin_revenue is distinct from v_montant or v_resa.final_status is distinct from v_statut
        or v_resa.arrival_date <> s.date_debut or v_resa.departure_date <> s.date_fin
        or v_resa.guest_name is distinct from v_lib or v_resa.guest_count is distinct from s.nb_personnes then
    update reservation set arrival_date = s.date_debut, departure_date = s.date_fin, nights = s.date_fin - s.date_debut,
      checkin_time = to_char(v_checkin at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), guest_name = v_lib,
      guest_count = s.nb_personnes, final_status = v_statut, fin_accommodation = v_montant, fin_revenue = v_montant,
      mois_comptable = v_mois, ventilation_calculee = false, updated_at = now()
    where id = v_resa.id;
  end if;
end $$;

create or replace function public.trg_sejour_hors_sync_reservation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform sejour_hors_sync_reservation(new.id);
  return new;
end $$;
drop trigger if exists trg_sejour_hors_sync_reservation on public.sejour_hors_hospitable;
create trigger trg_sejour_hors_sync_reservation
  after insert or update of menage_a_refacturer, refacturer_montant_centimes, annule_le, date_debut, date_fin, nom, type, nb_personnes
  on public.sejour_hors_hospitable for each row execute function public.trg_sejour_hors_sync_reservation();

-- Création : la réponse est optionnelle (NULL = « plus tard »), mais cohérente si donnée.
create or replace function public.sejour_hors_creer(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_bien uuid := (p->>'bien_id')::uuid; v_conf jsonb; v_row sejour_hors_hospitable; v_ref boolean := (p->>'menage_a_refacturer')::boolean;
  v_montant int := nullif(p->>'refacturer_montant_centimes', '')::int; v_motif text := nullif(trim(coalesce(p->>'refacturer_motif', '')), '');
begin
  if v_ref is true and coalesce(v_montant, 0) <= 0 then return jsonb_build_object('ok', false, 'erreur', 'montant du ménage à refacturer requis'); end if;
  if v_ref is false and coalesce(length(v_motif), 0) < 3 then return jsonb_build_object('ok', false, 'erreur', 'motif requis pour ne pas refacturer'); end if;
  perform pg_advisory_xact_lock(hashtextextended('calendrier:' || v_bien::text, 0));
  v_conf := calendrier_creneau_conflits(v_bien, (p->>'date_debut')::date, (p->>'date_fin')::date);
  if jsonb_array_length(v_conf) > 0 then return jsonb_build_object('ok', false, 'conflits', v_conf); end if;
  insert into sejour_hors_hospitable (bien_id, date_debut, date_fin, type, nom, nb_personnes, note, note_blocage,
    menage_a_refacturer, refacturer_montant_centimes, refacturer_motif, refacturer_repondu_le, refacturer_repondu_par, cree_par, cree_par_label)
  values (v_bien, (p->>'date_debut')::date, (p->>'date_fin')::date, p->>'type', p->>'nom', nullif(p->>'nb_personnes', '')::int,
    nullif(p->>'note', ''), p->>'note_blocage', v_ref, case when v_ref then v_montant end, case when v_ref is false then v_motif end,
    case when v_ref is not null then now() end, case when v_ref is not null then p->>'cree_par_label' end,
    nullif(p->>'cree_par', '')::uuid, p->>'cree_par_label')
  returning * into v_row;
  return jsonb_build_object('ok', true, 'sejour', to_jsonb(v_row));
end $$;

-- Réponse (ou changement de réponse) à la question.
create or replace function public.sejour_hors_refacturation_repondre(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid := (p->>'sejour_id')::uuid; v_ref boolean := (p->>'refacturer')::boolean; s sejour_hors_hospitable;
  v_montant int := nullif(p->>'montant_centimes', '')::int; v_motif text := nullif(trim(coalesce(p->>'motif', '')), ''); v_code text;
begin
  if v_ref is null then return jsonb_build_object('ok', false, 'erreur', 'réponse oui / non requise'); end if;
  if v_ref and coalesce(v_montant, 0) <= 0 then return jsonb_build_object('ok', false, 'erreur', 'montant du ménage à refacturer requis'); end if;
  if not v_ref and coalesce(length(v_motif), 0) < 3 then return jsonb_build_object('ok', false, 'erreur', 'motif requis pour ne pas refacturer'); end if;
  select * into s from sejour_hors_hospitable where id = v_id for update;
  if s.id is null then return jsonb_build_object('ok', false, 'erreur', 'séjour introuvable'); end if;
  update sejour_hors_hospitable set menage_a_refacturer = v_ref,
    refacturer_montant_centimes = case when v_ref then v_montant end, refacturer_motif = case when v_ref then null else v_motif end,
    refacturer_repondu_le = now(), refacturer_repondu_par = p->>'par', updated_at = now()
  where id = v_id returning * into s;
  select code into v_code from reservation where sejour_hors_id = v_id;
  return jsonb_build_object('ok', true, 'sejour', to_jsonb(s), 'reservation_code', v_code);
exception when others then
  if sqlerrm like 'mois_cloture:%' then return jsonb_build_object('ok', false, 'erreur', substr(sqlerrm, 15)); end if;
  raise;
end $$;
revoke all on function public.sejour_hors_sync_reservation(uuid) from public, anon, authenticated;
revoke all on function public.sejour_hors_refacturation_repondre(jsonb) from public, anon, authenticated;
revoke all on function public.sejour_hors_creer(jsonb) from public, anon, authenticated;
grant execute on function public.sejour_hors_refacturation_repondre(jsonb) to service_role;
grant execute on function public.sejour_hors_creer(jsonb) to service_role;

-- Ne pas compter deux fois le même séjour (ligne HORS + séjour hors Hospitable) :
--  · conflits de créneau (le blocage le refusait comme « résa ») ;
--  · simulation des règles de tâches (_sim_sejour : le séjour hors Hospitable a déjà sa branche dédiée).
-- Et nouvel écart du hub : question de refacturation sans réponse (« À faire », groupe Corriger).
do $mig$
declare d text; n int; a text; b text;
begin
  d := pg_get_functiondef('public.calendrier_creneau_conflits(uuid,date,date,uuid)'::regprocedure);
  a := 'where r.bien_id = p_bien and r.final_status = ''accepted''';
  n := (length(d) - length(replace(d, a, ''))) / length(a);
  if n <> 1 then raise exception 'calendrier_creneau_conflits : fragment trouvé % fois', n; end if;
  execute replace(d, a, a || ' and r.sejour_hors_id is null');

  d := pg_get_functiondef('public.mission_regles_simulation(date,date,jsonb)'::regprocedure);
  a := 'where r.final_status = ''accepted'' and r.departure_date >= p_du - 30 and r.arrival_date <= p_au + 25';
  n := (length(d) - length(replace(d, a, ''))) / length(a);
  if n <> 1 then raise exception 'mission_regles_simulation : fragment _sim_sejour trouvé % fois', n; end if;
  execute replace(d, a, a || ' and r.sejour_hors_id is null');

  d := pg_get_functiondef('public.mission_ecarts(date,date)'::regprocedure);
  a := E'\ntout as (select * from r1 union all';
  n := (length(d) - length(replace(d, a, ''))) / length(a);
  if n <> 1 then raise exception 'mission_ecarts : fragment tout trouvé % fois', n; end if;
  -- r7 en DERNIER dans l'union (les noms de colonnes viennent de r1)
  d := replace(d, 'union all select * from r6)', 'union all select * from r6 union all select * from r7)');
  b := E'\nr7 as (\n'
    || E'  select ''refacturation_hors_a_decider''::text, ''hors_refact:'' || sh.id, ''corriger''::text,\n'
    || E'         sh.bien_id, b.code, b.hospitable_name, coalesce(b.agence, ''dcb''), b.secteur, sh.date_fin, null::time,\n'
    || E'         null::uuid, null::text, null::uuid, null::text, null::uuid, null::text,\n'
    || E'         hub_echeance(sh.date_fin, null),\n'
    || E'         ''Séjour hors Hospitable « '' || sh.note_blocage || '' » du '' || to_char(sh.date_debut, ''DD/MM/YYYY'') || '' au '' || to_char(sh.date_fin, ''DD/MM/YYYY'')\n'
    || E'           || '' : refacturer le ménage au propriétaire ? Pas encore répondu — rien n''''est facturé tant qu''''on n''''a pas répondu''\n'
    || E'  from sejour_hors_hospitable sh join bien b on b.id = sh.bien_id\n'
    || E'  where sh.annule_le is null and sh.menage_a_refacturer is null and sh.date_fin between p_du - 30 and p_au\n'
    || E'),\ntout as (select * from r1 union all';
  execute replace(d, a, b);
end
$mig$;

-- ═══ 2. Fiche bien : tarifs, frais, disponibilité, annulation ════════════════════════════════════
create table if not exists public.bien_tarification (
  id        uuid primary key default gen_random_uuid(),
  bien_id   uuid not null references public.bien(id) on delete cascade,
  cle       text not null check (cle in (
              'prix_base_nuit', 'prix_base_weekend', 'prix_calendrier_semaine', 'prix_calendrier_weekend', 'majoration',
              'frais_menage', 'frais_linge', 'frais_resort', 'frais_community', 'frais_animaux', 'gestion_pct',
              'caution', 'caution_mode', 'remise_semaine', 'remise_mois', 'remise_last_minute', 'remise_last_minute_jours',
              'remise_early_bird', 'remise_early_bird_mois',
              'capacite_max', 'voyageurs_inclus', 'supplement_voyageur', 'animaux_acceptes',
              'min_nuits', 'max_nuits', 'fenetre_mois', 'heure_arrivee', 'heure_depart', 'canaux',
              'annulation', 'annulation_contrat', 'taxe',
              'reservation_instantanee')),   -- par bien ET par canal (Hospitable : un seul réglage pour tous les biens)
  canal     text not null default 'tous' check (canal in ('tous', 'airbnb', 'booking', 'direct')),
  source    text not null check (source in ('hospitable', 'historique', 'powerhouse')),
  valeur    numeric,      -- centimes (prix, frais, caution), % (majoration, gestion, remises), nombre
  mode      text check (mode in ('par_sejour', 'par_nuit', 'par_voyageur', 'par_voyageur_nuit', 'pct_hebergement')),
  texte     text,         -- valeurs texte (heures, canaux, politique d'annulation, nom de la taxe)
  options   jsonb,        -- attributs complémentaires (taxe : base, reversement ; remise : seuil…)
  -- caution_mode (texte) : aucune | stripe_contrat (empreinte carte du contrat, dcb-contrats payment_guarantees :
  -- SetupIntent à la signature, débit du montant réel dû après justification, libération) | hospitable
  -- (prélevée/remboursée par Hospitable) | manuelle. caution (valeur) = montant de référence.
  detail    text,         -- d'où vient la valeur (« Community fee de HM3NMJNZRD, arrivée 25/01/2027 »…)
  maj_le    timestamptz not null default now(),
  maj_par   text,
  unique (bien_id, cle, canal, source)
);
create index if not exists idx_bien_tarification_bien on public.bien_tarification(bien_id);
comment on table public.bien_tarification is
  'Fiche « Tarifs & frais / Disponibilité / Annulation » d''un bien (400). Une valeur par clé × canal × SOURCE ; valeur retenue = PowerHouse (saisie) > Hospitable (cron-bien-tarification, quotidien) > historique (résas directes/manuelles/OTA). L''API Hospitable n''expose PAS les réglages Pricing/Fees/Deposits/Discounts/Policies : ce qui en vient = capacité, animaux, horaires, canaux, prix et séjour minimum du calendrier.';

alter table public.bien_tarification enable row level security;
drop policy if exists bien_tarification_lecture on public.bien_tarification;
create policy bien_tarification_lecture on public.bien_tarification for select to authenticated
  using (auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids())));
-- Saisie PowerHouse : seulement les lignes source « powerhouse » (Hospitable / historique = cron, service_role).
drop policy if exists bien_tarification_saisie on public.bien_tarification;
create policy bien_tarification_saisie on public.bien_tarification for all to authenticated
  using (source = 'powerhouse' and auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids())))
  with check (source = 'powerhouse' and auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids())));
revoke all on public.bien_tarification from anon;

-- Historique des modifications de la fiche (saisies PowerHouse) : qui, quand, avant → après.
create table if not exists public.bien_tarification_journal (
  id         bigserial primary key,
  bien_id    uuid not null,
  cle        text not null,
  canal      text not null,
  operation  text not null check (operation in ('ajout', 'modification', 'suppression')),
  avant      jsonb,
  apres      jsonb,
  par        text,
  le         timestamptz not null default now()
);
create index if not exists idx_bien_tarification_journal on public.bien_tarification_journal(bien_id, le desc);
alter table public.bien_tarification_journal enable row level security;
drop policy if exists bien_tarification_journal_lecture on public.bien_tarification_journal;
create policy bien_tarification_journal_lecture on public.bien_tarification_journal for select to authenticated
  using (auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids())));
revoke insert, update, delete on public.bien_tarification_journal from anon, authenticated;

create or replace function public.trg_bien_tarification_journal()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_par text := coalesce(auth.email(), 'système');
begin
  if coalesce(new.source, old.source) <> 'powerhouse' then return coalesce(new, old); end if;
  if tg_op = 'INSERT' then
    insert into bien_tarification_journal (bien_id, cle, canal, operation, apres, par)
    values (new.bien_id, new.cle, new.canal, 'ajout', jsonb_build_object('valeur', new.valeur, 'mode', new.mode, 'texte', new.texte, 'options', new.options), coalesce(new.maj_par, v_par));
  elsif tg_op = 'UPDATE' then
    if (old.valeur, old.mode, old.texte, old.options) is distinct from (new.valeur, new.mode, new.texte, new.options) then
      insert into bien_tarification_journal (bien_id, cle, canal, operation, avant, apres, par)
      values (new.bien_id, new.cle, new.canal, 'modification',
        jsonb_build_object('valeur', old.valeur, 'mode', old.mode, 'texte', old.texte, 'options', old.options),
        jsonb_build_object('valeur', new.valeur, 'mode', new.mode, 'texte', new.texte, 'options', new.options), coalesce(new.maj_par, v_par));
    end if;
  else
    insert into bien_tarification_journal (bien_id, cle, canal, operation, avant, par)
    values (old.bien_id, old.cle, old.canal, 'suppression', jsonb_build_object('valeur', old.valeur, 'mode', old.mode, 'texte', old.texte, 'options', old.options), v_par);
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists trg_bien_tarification_journal on public.bien_tarification;
create trigger trg_bien_tarification_journal after insert or update or delete on public.bien_tarification
  for each row execute function public.trg_bien_tarification_journal();

-- Historique des résas + calendrier → lignes « historique » / « hospitable » (prix et min du calendrier).
-- Règle par frais : dernière résa du canal qui le porte (parmi les 5 dernières) ; absent des 3+ dernières
-- résas du canal → 0 (« absent des N dernières résas »). Montants en centimes, % arrondis à 0,1.
create or replace function public.bien_tarification_rafraichir(p_bien uuid default null)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from bien_tarification where source = 'historique' and (p_bien is null or bien_id = p_bien);
  delete from bien_tarification where source = 'hospitable' and cle in ('prix_calendrier_semaine', 'prix_calendrier_weekend', 'min_nuits')
    and (p_bien is null or bien_id = p_bien);

  with r as (
    select r.bien_id, r.code, r.arrival_date,
           case when r.platform in ('direct', 'manual') then 'direct' else r.platform end as canal,
           nullif((r.hospitable_raw->'financials'->'guest'->'accommodation'->>'amount')::numeric, 0) as acc,
           coalesce(r.hospitable_raw->'financials'->'guest'->'fees', '[]'::jsonb) as fees,
           coalesce(r.hospitable_raw->'financials'->'guest'->'discounts', '[]'::jsonb) as disc
    from reservation r
    where r.final_status = 'accepted' and not coalesce(r.owner_stay, false) and r.sejour_hors_id is null
      and r.platform in ('airbnb', 'booking', 'direct', 'manual') and r.hospitable_raw is not null
      and r.arrival_date >= current_date - 540 and (p_bien is null or r.bien_id = p_bien)
  ),
  rn as (select r.*, row_number() over (partition by bien_id, canal order by arrival_date desc, code) as rang,
                count(*) over (partition by bien_id, canal) as nb from r),
  -- Une ligne par résa × clé : montant (centimes) ou % de l'hébergement
  m as (
    select x.bien_id, x.canal, x.code, x.arrival_date, x.rang, x.nb, k.cle, k.mode, k.v
    from rn x
    cross join lateral (values
      ('frais_community', 'par_sejour', (select sum((f->>'amount')::numeric) from jsonb_array_elements(x.fees) f where lower(f->>'label') = 'community fee')),
      ('frais_menage', 'par_sejour', (select sum((f->>'amount')::numeric) from jsonb_array_elements(x.fees) f where lower(f->>'label') in ('cleaning fee', 'frais de ménage'))),
      ('frais_linge', 'par_sejour', (select sum((f->>'amount')::numeric) from jsonb_array_elements(x.fees) f where lower(f->>'label') = 'linen fee')),
      ('frais_animaux', 'par_sejour', (select sum((f->>'amount')::numeric) from jsonb_array_elements(x.fees) f where lower(f->>'label') = 'pet fee')),
      ('frais_resort', 'pct_hebergement', (select round(100 * sum((f->>'amount')::numeric) / x.acc, 1) from jsonb_array_elements(x.fees) f where lower(f->>'label') = 'resort fee')),
      ('gestion_pct', null, (select round(100 * sum((f->>'amount')::numeric) / x.acc, 1) from jsonb_array_elements(x.fees) f
                              where lower(f->>'label') = 'management fee' or lower(f->>'label') like 'frais de service%')),
      ('remise_semaine', null, (select round(-100 * sum((f->>'amount')::numeric) / x.acc, 1) from jsonb_array_elements(x.disc) f where lower(f->>'label') = 'weekly discount')),
      ('remise_mois', null, (select round(-100 * sum((f->>'amount')::numeric) / x.acc, 1) from jsonb_array_elements(x.disc) f where lower(f->>'label') = 'monthly discount')),
      ('remise_last_minute', null, (select round(-100 * sum((f->>'amount')::numeric) / x.acc, 1) from jsonb_array_elements(x.disc) f where lower(f->>'label') = 'last minute discount'))
    ) as k(cle, mode, v)
    where x.acc is not null or k.cle in ('frais_community', 'frais_menage', 'frais_linge', 'frais_animaux')
  ),
  pos as (select distinct on (bien_id, canal, cle) * from m where coalesce(v, 0) > 0 and rang <= 5 order by bien_id, canal, cle, rang),
  -- Les remises ne s'appliquent qu'à certains séjours : jamais de « 0 » déduit de leur absence.
  zero as (select bien_id, canal, cle, min(mode) as mode, max(nb) as nb from m
           where rang <= 3 and nb >= 3 and cle not like 'remise%'
           group by bien_id, canal, cle having bool_and(coalesce(v, 0) = 0))
  insert into bien_tarification (bien_id, cle, canal, source, valeur, mode, detail, maj_par)
  select bien_id, cle, canal, 'historique', v, mode,
         case when cle like 'remise%' or cle in ('gestion_pct', 'frais_resort') then v || ' % de l''hébergement sur ' else 'montant de ' end
           || code || ' (arrivée ' || to_char(arrival_date, 'DD/MM/YYYY') || ')', 'historique des résas'
  from pos
  union all
  select bien_id, cle, canal, 'historique', 0, mode, 'absent des ' || least(nb, 3) || ' dernières résas ' || canal, 'historique des résas'
  from zero z where not exists (select 1 from pos p where p.bien_id = z.bien_id and p.canal = z.canal and p.cle = z.cle);
  get diagnostics n = row_count;

  -- Prix et séjour minimum du calendrier Hospitable (calendrier_jour, sync toutes les 5 min) : 90 prochains jours.
  insert into bien_tarification (bien_id, cle, canal, source, valeur, mode, detail, maj_par)
  select c.bien_id, k.cle, 'tous', 'hospitable', k.v, k.mode, k.detail, 'calendrier Hospitable'
  from (select bien_id,
               percentile_cont(0.5) within group (order by prix_centimes) filter (where extract(isodow from jour) not in (5, 6)) as sem,
               percentile_cont(0.5) within group (order by prix_centimes) filter (where extract(isodow from jour) in (5, 6)) as we,
               mode() within group (order by min_nuits) as minn, count(prix_centimes) as nbp
        from calendrier_jour where jour between current_date and current_date + 90 and (p_bien is null or bien_id = p_bien)
        group by bien_id) c
  cross join lateral (values
    ('prix_calendrier_semaine', round(c.sem), 'par_nuit', 'médiane du calendrier Hospitable, nuits du dimanche au jeudi, 90 prochains jours (prix du jour, PriceLabs compris)'),
    ('prix_calendrier_weekend', round(c.we), 'par_nuit', 'médiane du calendrier Hospitable, nuits du vendredi et du samedi, 90 prochains jours'),
    ('min_nuits', c.minn::numeric, null, 'séjour minimum le plus fréquent du calendrier Hospitable, 90 prochains jours (modifiable jour par jour)')
  ) as k(cle, v, mode, detail)
  where k.v is not null and c.nbp > 0;
  return n;
end $$;
revoke all on function public.bien_tarification_rafraichir(uuid) from public, anon, authenticated;
grant execute on function public.bien_tarification_rafraichir(uuid) to service_role;

-- ═══ 3. Choix du paiement d'une résa manuelle ════════════════════════════════════════════════════
-- Modes = ceux que le contrat sait exécuter (generate-contract MODE_PAIEMENT_CONFIG + dcb-contrats
-- _finalizeSignature / cron-payments) : virement (RIB séquestre dans le contrat, preuve demandée),
-- carte Stripe (acompte prélevé à la signature, solde prélevé automatiquement à la date du solde),
-- solde en espèces à l'arrivée, ou déjà payé par carte (module direct : paiement Stripe AVANT la résa).
create table if not exists public.resa_paiement_choix (
  id                     uuid primary key default gen_random_uuid(),
  bien_id                uuid not null references public.bien(id) on delete restrict,
  arrivee                date not null,
  depart                 date not null,
  voyageur_nom           text,
  voyageur_email         text,
  origine                text not null default 'powerhouse' check (origine in ('powerhouse', 'devis', 'module_direct')),
  devis_id               uuid references public.devis_option(id) on delete set null,
  payment_channel        text not null check (payment_channel in ('bank_transfer', 'stripe_dcb_contract', 'stripe_dcb_already_paid')),
  mode_paiement          text not null check (mode_paiement in ('virement_100', 'virement_50_50', 'virement_30_70', 'virement_50_cash',
                                                                 'cb_100', 'cb_50_50', 'cb_30_70', 'cb_50_cash')),
  date_solde             date,
  guarantee_mode         text not null default 'stripe_card_on_file' check (guarantee_mode in ('stripe_card_on_file', 'none')),
  caution_mode           text check (caution_mode in ('aucune', 'stripe_contrat', 'hospitable', 'manuelle')),
  caution_centimes       int check (caution_centimes is null or caution_centimes >= 0),
  politique_annulation   text not null check (politique_annulation in ('flexible', 'moderee', 'stricte', 'super_stricte_30', 'non_remboursable')),
  total_centimes         int not null check (total_centimes >= 0),
  acompte_centimes       int not null check (acompte_centimes >= 0),
  solde_centimes         int not null check (solde_centimes >= 0),
  stripe_payment_intent_id text,
  reservation_hospitable_id text,
  reservation_code       text,
  contract_id            uuid,
  statut                 text not null default 'en_attente' check (statut in ('en_attente', 'lie', 'annule')),
  cree_par               uuid,
  cree_par_label         text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  check (depart > arrivee)
);
create unique index if not exists uq_resa_paiement_choix_code on public.resa_paiement_choix(reservation_code) where reservation_code is not null and statut <> 'annule';
create index if not exists idx_resa_paiement_choix_bien on public.resa_paiement_choix(bien_id, arrivee) where statut = 'en_attente';
comment on table public.resa_paiement_choix is
  'Paiement choisi par le bureau à la création d''une résa manuelle (Calendrier PowerHouse, api/dispo-action.js) ou par le futur module direct : lu par webhook-hospitable / cron-auto-contracts / brouillon de contrat (api/_paiementResa.js) à la place de la règle par canal (paramsContrat). Écriture service_role uniquement (400).';
alter table public.resa_paiement_choix enable row level security;
drop policy if exists resa_paiement_choix_lecture on public.resa_paiement_choix;
create policy resa_paiement_choix_lecture on public.resa_paiement_choix for select to authenticated
  using (auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids())));
revoke insert, update, delete on public.resa_paiement_choix from anon, authenticated;
revoke all on public.resa_paiement_choix from anon;

alter table public.devis_option add column if not exists paiement jsonb;
comment on column public.devis_option.paiement is 'Paiement choisi au devis (même forme que resa_paiement_choix), repris à la conversion en résa (400).';

alter table public.dispo_action_log drop constraint if exists dispo_action_log_action_check;
alter table public.dispo_action_log add constraint dispo_action_log_action_check check (action in (
  'block', 'unblock', 'set_rules', 'create_direct_reservation', 'create_manual_reservation',
  'devis_option', 'devis_prolonger', 'devis_annuler', 'devis_convertir', 'devis_expire',
  'sejour_hors_hospitable', 'sejour_hors_bloquer', 'sejour_hors_annuler', 'sejour_hors_refacturation', 'contrat_brouillon'));
