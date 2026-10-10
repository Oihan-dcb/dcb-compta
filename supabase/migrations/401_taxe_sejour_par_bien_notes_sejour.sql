-- 401 — Taxe de séjour réglée PAR BIEN + notes internes de séjour (11/10/2026, demande Oïhan :
--       « il faut pouvoir configurer CHAQUE BIEN, car la taxe est définie par les étoiles »).
--
-- Modèle (rien n'est dupliqué) :
--   • le RÉGLAGE est sur le bien : classement (déjà bien.classification + dates 038), commune de la taxe
--     (taxe_commune, repli bien.ville), régime (au réel / au forfait), qui collecte par canal, tarif saisi
--     pour une « autre catégorie légale », note ; classification_confirmee distingue « non classé » vérifié
--     du défaut de colonne (non_classe était la valeur par défaut, donc ambiguë) ;
--   • le BARÈME reste dans taxe_sejour_config (commune × catégorie × année) : c'est une donnée légale de la
--     commune, pas du bien. Il devient lisible par tout le staff (lecture seule) ; l'écriture reste au bureau ;
--   • taxe_sejour_bien(bien, jour) résout le réglage + le barème applicable (classement expiré → non classé,
--     chambre d'hôtes → ligne « chambre d'hôtes » ou à défaut 1★ qui la porte légalement, barème de la commune
--     quelle que soit l'agence) et ce qu'Hospitable a réellement facturé sur la dernière résa Direct (écarts).
--     Utilisée par PowerHouse (fiche 💶 Tarifs & frais, résa manuelle, séjour type) ; dcb-compta PageTaxeSejour
--     applique la même résolution côté client (src/lib/taxeSejour.js).
--   • La ventilation n'est PAS concernée : la ligne TAXE vient des taxes facturées par Hospitable
--     (ventilationCore.js), jamais de ce barème.
--
-- Migration de données (conséquence directe du nouveau champ, rien d'autre n'est modifié) :
--   classification_confirmee = true pour les biens dont le classement a été saisi (≠ non_classe, ou une date
--   de classement est renseignée) — source : import du tableur Classements (migrations 037/045/038).
--   Les autres (non_classe par défaut) restent à confirmer → signalés dans « À vérifier ».
--
-- Notes de séjour : table sejour_note (résa OU séjour hors Hospitable), staff + périmètre, suppression douce.
--
-- Appliquée en prod le 11/10/2026 en deux migrations : 401a_taxe_sejour_par_bien (§1-3) et 401b_sejour_note (§4).
-- Testée avant en transaction annulée (416 → Biarritz 1★ 1,15 €, Hospitable « Taxe 1 étoile » 9,20 € / 2 ad. × 4 n. ;
-- 33 biens passés « classement confirmé » ; PATXI / EGOA : dates de classement incohérentes, signalées).

-- ── 1. Réglage taxe sur le bien ───────────────────────────────────────────────────────────────────────────
alter table public.bien
  add column if not exists taxe_commune            text,
  add column if not exists taxe_regime             text not null default 'reel',
  add column if not exists taxe_collecte           jsonb not null default '{"airbnb":"plateforme","booking":"nous","direct":"nous"}'::jsonb,
  add column if not exists classification_confirmee boolean not null default false,
  add column if not exists taxe_tarif_saisi        numeric(8,2),
  add column if not exists taxe_note               text,
  add column if not exists taxe_maj_le             timestamptz,
  add column if not exists taxe_maj_par            text;

alter table public.bien drop constraint if exists bien_taxe_regime_check;
alter table public.bien add constraint bien_taxe_regime_check check (taxe_regime in ('reel', 'forfait'));
alter table public.bien drop constraint if exists bien_classification_check;
alter table public.bien add constraint bien_classification_check check (classification is null or classification in
  ('non_classe', '1_etoile', '2_etoiles', '3_etoiles', '4_etoiles', '5_etoiles', 'palace', 'chambre_hotes', 'autre'));
alter table public.bien drop constraint if exists bien_taxe_collecte_check;
alter table public.bien add constraint bien_taxe_collecte_check check (
  jsonb_typeof(taxe_collecte) = 'object'
  and coalesce(taxe_collecte->>'airbnb', 'plateforme') in ('plateforme', 'nous')
  and coalesce(taxe_collecte->>'booking', 'nous') in ('plateforme', 'nous')
  and coalesce(taxe_collecte->>'direct', 'nous') in ('plateforme', 'nous'));
alter table public.bien drop constraint if exists bien_taxe_tarif_saisi_check;
alter table public.bien add constraint bien_taxe_tarif_saisi_check check (taxe_tarif_saisi is null or (taxe_tarif_saisi >= 0 and taxe_tarif_saisi <= 50));

comment on column public.bien.taxe_commune is 'Commune de perception de la taxe de séjour (repli : ville). Clé de taxe_sejour_config.commune.';
comment on column public.bien.taxe_regime is 'reel = collectée auprès du voyageur ; forfait = le propriétaire paie un forfait (rien facturé au voyageur).';
comment on column public.bien.taxe_collecte is 'Qui collecte la taxe par canal : plateforme (Airbnb la reverse elle-même) ou nous (déclaration agence).';
comment on column public.bien.classification_confirmee is 'Classement vérifié par l''équipe (le défaut non_classe n''est pas une information).';
comment on column public.bien.taxe_tarif_saisi is '€ par personne et par nuit, taxes additionnelles comprises, pour une « autre » catégorie légale (camping, village vacances…).';

-- Données : classement saisi = confirmé (voir en-tête).
update public.bien set classification_confirmee = true
 where not classification_confirmee and (coalesce(classification, 'non_classe') <> 'non_classe' or classification_date is not null);

-- Un changement de classement (PowerHouse ou dcb-compta PageBiens) vaut confirmation.
create or replace function public.trg_bien_classement_confirme()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.classification is distinct from old.classification and new.classification_confirmee is not distinct from old.classification_confirmee then
    new.classification_confirmee := true;
  end if;
  return new;
end $$;
drop trigger if exists trg_bien_classement_confirme on public.bien;
create trigger trg_bien_classement_confirme before update of classification on public.bien
  for each row execute function public.trg_bien_classement_confirme();

-- Historique (même journal que la fiche Tarifs & frais, clé « taxe_sejour »).
create or replace function public.trg_bien_taxe_journal()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  a jsonb := jsonb_build_object('classement', old.classification, 'confirme', old.classification_confirmee, 'date', old.classification_date,
    'fin', old.classification_fin, 'commune', old.taxe_commune, 'regime', old.taxe_regime, 'collecte', old.taxe_collecte,
    'tarif_saisi', old.taxe_tarif_saisi, 'note', old.taxe_note);
  n jsonb := jsonb_build_object('classement', new.classification, 'confirme', new.classification_confirmee, 'date', new.classification_date,
    'fin', new.classification_fin, 'commune', new.taxe_commune, 'regime', new.taxe_regime, 'collecte', new.taxe_collecte,
    'tarif_saisi', new.taxe_tarif_saisi, 'note', new.taxe_note);
begin
  if a is distinct from n then
    insert into bien_tarification_journal (bien_id, cle, canal, operation, avant, apres, par)
    values (new.id, 'taxe_sejour', 'tous', 'modification', a, n, coalesce(auth.email(), new.taxe_maj_par, 'système'));
  end if;
  return new;
end $$;
drop trigger if exists trg_bien_taxe_journal on public.bien;
create trigger trg_bien_taxe_journal after update of classification, classification_confirmee, classification_date, classification_fin,
  taxe_commune, taxe_regime, taxe_collecte, taxe_tarif_saisi, taxe_note on public.bien
  for each row execute function public.trg_bien_taxe_journal();

-- ── 2. Barème : lecture staff (donnée légale publique), écriture bureau inchangée ────────────────────────
drop policy if exists taxe_sejour_config_lecture_staff on public.taxe_sejour_config;
create policy taxe_sejour_config_lecture_staff on public.taxe_sejour_config for select to authenticated
  using (auth_user_is_staff());

-- ── 3. Résolution par bien ────────────────────────────────────────────────────────────────────────────────
-- Renvoie le réglage, le barème retenu (null si aucun) et les observations Hospitable / Booking.
-- Classement expiré (fin < jour, dates cohérentes) → barème « non classé » (le classement ne vaut plus).
-- Dates incohérentes (fin ≤ date de classement, saisie fautive) : PAS traitées comme expirées, signalées.
create or replace function public.taxe_sejour_bien(p_bien uuid, p_jour date default current_date)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare
  b record; bar record; v_trouve boolean := false;
  v_commune text; v_src text; v_classe text; v_eff text; v_expire boolean; v_incoh boolean;
  v_cherche text[]; v_annee int := extract(year from p_jour)::int;
  v_hosp jsonb; v_book jsonb;
begin
  select id, agence, ville, classification, classification_confirmee, classification_date, classification_fin,
         taxe_commune, taxe_regime, taxe_collecte, taxe_tarif_saisi, taxe_note, taxe_maj_le, taxe_maj_par
    into b from bien where id = p_bien;
  if not found then return null; end if;

  v_commune := nullif(trim(coalesce(nullif(trim(b.taxe_commune), ''), b.ville)), '');
  v_src := case when nullif(trim(b.taxe_commune), '') is not null then 'saisie' when v_commune is not null then 'ville' end;
  v_classe := coalesce(b.classification, 'non_classe');
  v_incoh := b.classification_fin is not null and b.classification_date is not null and b.classification_fin <= b.classification_date;
  v_expire := v_classe in ('1_etoile', '2_etoiles', '3_etoiles', '4_etoiles', '5_etoiles', 'palace')
              and b.classification_fin is not null and not v_incoh and b.classification_fin < p_jour;
  v_eff := case when v_expire then 'non_classe' else v_classe end;
  v_cherche := case v_eff when 'chambre_hotes' then array['chambre_hotes', '1_etoile'] when 'autre' then array[]::text[] else array[v_eff] end;

  if v_commune is not null and cardinality(v_cherche) > 0 then
    select c.id, c.agence, c.commune, c.classification, c.annee, c.type_calcul, c.taux_pct, c.plafond_ht, c.tarif_pers_nuit,
           c.coeff_additionnel, c.notes
      into bar
      from taxe_sejour_config c
     where lower(trim(c.commune)) = lower(v_commune) and c.classification = any(v_cherche)
     order by array_position(v_cherche, c.classification), abs(c.annee - v_annee), (c.agence = b.agence) desc, c.annee desc
     limit 1;
    v_trouve := found;
  end if;

  -- Dernière résa Hospitable Direct avec une taxe (réglage « Taxes » d'Hospitable, non exposé par l'API).
  select jsonb_build_object('code', r.code, 'arrivee', r.arrival_date, 'libelle', t->>'label', 'montant_centimes', (t->>'amount')::int,
           'nuits', r.nights, 'adultes', coalesce(nullif(r.hospitable_raw->'guests'->>'adult_count', '')::int, r.guest_count),
           'voyageurs', coalesce(nullif(r.hospitable_raw->'guests'->>'total', '')::int, r.guest_count))
    into v_hosp
    from reservation r
    cross join lateral jsonb_array_elements(coalesce(r.hospitable_raw->'financials'->'guest'->'taxes', '[]'::jsonb)) t
   where r.bien_id = p_bien and r.platform = 'direct' and r.final_status = 'accepted' and not coalesce(r.owner_stay, false)
     and coalesce((t->>'amount')::int, 0) > 0 and coalesce(t->>'label', '') !~* '^(pass-through|tva)'
   order by r.arrival_date desc
   limit 1;

  -- Dernière résa Booking portant une taxe de séjour (CITY_TAX) : dit si Booking la retient (« Withheld »).
  select jsonb_build_object('code', r.code, 'arrivee', r.arrival_date, 'libelle', t->>'label', 'montant_centimes', (t->>'amount')::int)
    into v_book
    from reservation r
    cross join lateral jsonb_array_elements(coalesce(r.hospitable_raw->'financials'->'guest'->'taxes', '[]'::jsonb)) t
   where r.bien_id = p_bien and r.platform = 'booking' and r.final_status = 'accepted' and coalesce(t->>'label', '') ~* 'city.?tax'
   order by r.arrival_date desc
   limit 1;

  return jsonb_build_object(
    'bien_id', b.id, 'agence', b.agence, 'ville', b.ville,
    'commune', v_commune, 'commune_source', v_src,
    'classement', v_classe, 'classement_effectif', v_eff, 'confirme', b.classification_confirmee,
    'date', b.classification_date, 'fin', b.classification_fin, 'expire', v_expire, 'dates_incoherentes', v_incoh,
    'regime', b.taxe_regime, 'collecte', b.taxe_collecte, 'tarif_saisi', b.taxe_tarif_saisi, 'note', b.taxe_note,
    'maj_le', b.taxe_maj_le, 'maj_par', b.taxe_maj_par, 'annee', v_annee,
    'bareme', case when v_trouve then jsonb_build_object('id', bar.id, 'agence', bar.agence, 'commune', bar.commune,
       'classification', bar.classification, 'annee', bar.annee, 'type_calcul', bar.type_calcul, 'taux_pct', bar.taux_pct,
       'plafond_ht', bar.plafond_ht, 'tarif_pers_nuit', bar.tarif_pers_nuit, 'coeff_additionnel', bar.coeff_additionnel,
       'notes', bar.notes, 'ligne_equivalente', bar.classification <> v_eff) end,
    'hospitable', v_hosp, 'booking', v_book);
end $$;
revoke all on function public.taxe_sejour_bien(uuid, date) from public, anon;
grant execute on function public.taxe_sejour_bien(uuid, date) to authenticated, service_role;

-- ── 4. Notes internes de séjour (panneau du séjour, Calendrier PowerHouse) ───────────────────────────────
create table if not exists public.sejour_note (
  id             uuid primary key default gen_random_uuid(),
  reservation_id uuid references public.reservation(id) on delete cascade,
  sejour_hors_id uuid references public.sejour_hors_hospitable(id) on delete cascade,
  bien_id        uuid not null references public.bien(id) on delete cascade,
  texte          text not null check (length(btrim(texte)) between 1 and 4000),
  auteur         text default auth.email(),
  created_at     timestamptz not null default now(),
  supprime_le    timestamptz,
  supprime_par   text,
  constraint sejour_note_une_cible check (num_nonnulls(reservation_id, sejour_hors_id) = 1)
);
create index if not exists idx_sejour_note_resa on public.sejour_note(reservation_id) where reservation_id is not null;
create index if not exists idx_sejour_note_hors on public.sejour_note(sejour_hors_id) where sejour_hors_id is not null;
alter table public.sejour_note enable row level security;
drop policy if exists sejour_note_staff on public.sejour_note;
create policy sejour_note_staff on public.sejour_note for all to authenticated
  using (auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids())))
  with check (auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids())));
revoke delete on public.sejour_note from authenticated, anon;
revoke all on public.sejour_note from anon;
