-- 462 — Demande en ligne de bail mobilité (17/10/2026, demande d'Oïhan)
-- Les biens réglés bien.mode_location_site = 'bail_mobilite' (453) affichaient seulement « Nous contacter » (mailto).
-- Le bloc du site (/w/site) et la liste /reserver proposent maintenant un FORMULAIRE de demande (FR/EN/ES) :
-- dates d'entrée / de sortie (1 à 10 mois, art. 25-14 loi 89-462), motif légal (art. 25-12), occupants, coordonnées,
-- message, consentement. AUCUNE pièce justificative à ce stade (demandée ensuite par l'équipe).
-- PowerHouse (Gestion LLD › 📨 Demandes bail mobilité) : en cours / refuser / « Créer le bail » (rental_contracts
-- type_contrat='mobilite' pré-rempli, suite dans Contrats › BailMobilitePanel).
-- Conservation : demandes clôturées (acceptée / refusée / expirée) anonymisées 6 mois après la clôture ; demande
-- jamais traitée = expirée quand la date d'entrée souhaitée est passée (ou 6 mois après le dépôt). Exécuté chaque nuit
-- par api/cron-purge-identite.js (même tournée que les autres purges), simulation ?dry=1.

-- ── Loyer indicatif affiché sur le site (fiche bien › 🌐 Site : bail mobilité) ─────────────────────────────
alter table bien add column if not exists loyer_mobilite_cts integer check (loyer_mobilite_cts is null or loyer_mobilite_cts >= 0);
alter table bien add column if not exists charges_mobilite_cts integer check (charges_mobilite_cts is null or charges_mobilite_cts >= 0);
comment on column bien.loyer_mobilite_cts is 'Bail mobilité : loyer mensuel indicatif HORS charges (centimes), affiché sur le site ; NULL = « loyer sur demande » (462)';
comment on column bien.charges_mobilite_cts is 'Bail mobilité : forfait de charges mensuel indicatif (centimes), affiché avec le loyer ; pré-remplit le bail (462)';

-- ── Demandes ─────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists bail_demande (
  id                uuid primary key default gen_random_uuid(),
  agence            text not null default 'dcb',
  bien_id           uuid not null references bien(id) on delete cascade,
  date_entree       date not null,
  date_sortie       date not null,
  occupants         smallint not null check (occupants between 1 and 12),
  prenom            text,
  nom               text,
  email             text,
  telephone         text,
  motif             text not null check (motif in ('formation','etudes','apprentissage','stage','service_civique','mutation','mission_temporaire')),
  motif_precision   text,
  message           text,
  langue            text not null default 'fr' check (langue in ('fr','en','es')),
  loyer_affiche_cts integer,          -- loyer + charges indicatifs affichés au moment de la demande (NULL = sur demande)
  dispo_au_depot    boolean,          -- la période était libre au dépôt (contrôle serveur)
  consentement      jsonb not null default '{}'::jsonb,
  ip_hash           text check (ip_hash is null or ip_hash ~ '^[a-f0-9]{24}$'),
  test              boolean not null default false,
  statut            text not null default 'nouvelle' check (statut in ('nouvelle','en_cours','acceptee','refusee','expiree')),
  motif_refus       text,
  note_equipe       text,
  contract_id       uuid references rental_contracts(id) on delete set null,
  traite_par        text,
  traite_le         timestamptz,
  cloture_le        timestamptz,
  anonymise_le      timestamptz,
  mail_envoye_le    timestamptz,
  cree_le           timestamptz not null default now(),
  maj_le            timestamptz not null default now(),
  check (date_sortie > date_entree)
);
create index if not exists bail_demande_bien_idx on bail_demande (bien_id, statut);
create index if not exists bail_demande_statut_idx on bail_demande (statut, cree_le desc);
comment on table bail_demande is 'Demandes en ligne de bail mobilité (site / Réserver), 462. Lecture / écriture par les API service_role seulement (api/direct.js, api/bail-demandes.js).';

alter table bail_demande enable row level security;
revoke all on bail_demande from anon, authenticated;

-- ── Disponibilité d'un bien sur une période (aucune donnée de séjour renvoyée, seulement vrai / faux) ─────
-- Occupé si chevauchement [entrée, sortie[ avec : une réservation non annulée (Hospitable, synchronisée), un bail
-- étudiant / LLD (etudiant), un bail mobilité non annulé (rental_contracts), une demande déjà acceptée.
create or replace function bail_demande_dispo(p_bien uuid, p_entree date, p_sortie date)
returns boolean language sql stable security definer set search_path = public as $$
  select p_sortie > p_entree
  and not exists (
    select 1 from reservation r
    where r.bien_id = p_bien
      and coalesce(r.final_status, 'accepted') in ('accepted', 'checkpoint', 'request', 'request request to book')
      and r.arrival_date::date < p_sortie and r.departure_date::date > p_entree)
  and not exists (
    select 1 from etudiant e
    where e.bien_id = p_bien and e.date_entree is not null
      and e.date_entree < p_sortie
      and coalesce(e.date_sortie_reelle, e.date_sortie_prevue, 'infinity'::date) > p_entree)
  and not exists (
    select 1 from rental_contracts c
    where c.bien_id = p_bien and c.type_contrat = 'mobilite'
      and c.statut not in ('cancelled', 'expired_unsigned')
      and coalesce(nullif(c.bail_data #>> '{conditions,date_effet}', ''), nullif(c.sejour_snapshot ->> 'date_arrivee', ''))::date < p_sortie
      and coalesce(nullif(c.bail_data #>> '{conditions,date_fin}', ''), nullif(c.sejour_snapshot ->> 'date_depart', ''))::date > p_entree)
  and not exists (
    select 1 from bail_demande d
    where d.bien_id = p_bien and d.statut = 'acceptee' and d.contract_id is null
      and d.date_entree < p_sortie and d.date_sortie > p_entree);
$$;
revoke all on function bail_demande_dispo(uuid, date, date) from public, anon, authenticated;
grant execute on function bail_demande_dispo(uuid, date, date) to service_role;

-- ── Expiration + anonymisation (cron nuit, api/cron-purge-identite.js) ───────────────────────────────────
-- 1. nouvelle / en cours dont la date d'entrée souhaitée est passée, ou déposée il y a plus de 6 mois → expirée.
-- 2. clôturée (acceptée / refusée / expirée) depuis plus de 6 mois → coordonnées, précision, message, note et trace
--    IP effacées (bien, dates, motif, occupants et statut gardés pour les statistiques). Une demande acceptée a
--    transmis ses données au bail (conservé 5 ans, 440) : la demande elle-même n'a plus à les garder.
-- 3. demandes marquées test : supprimées après 1 jour.
create or replace function bail_demande_purge(p_jour date default current_date, p_dry boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_exp int; v_anon int; v_test int;
  v_limite timestamptz := (p_jour - interval '6 months');
begin
  select count(*) into v_exp from bail_demande
   where statut in ('nouvelle','en_cours') and (date_entree < p_jour or cree_le < v_limite);
  select count(*) into v_anon from bail_demande
   where anonymise_le is null and statut in ('acceptee','refusee','expiree') and coalesce(cloture_le, maj_le) < v_limite;
  select count(*) into v_test from bail_demande where test and cree_le < p_jour - interval '1 day';
  if not p_dry then
    update bail_demande set statut = 'expiree', cloture_le = now(), maj_le = now(), traite_par = coalesce(traite_par, 'auto')
     where statut in ('nouvelle','en_cours') and (date_entree < p_jour or cree_le < v_limite);
    update bail_demande set prenom = null, nom = null, email = null, telephone = null, motif_precision = null,
           message = null, note_equipe = null, motif_refus = null, ip_hash = null,
           consentement = jsonb_build_object('anonymise', true), anonymise_le = now(), maj_le = now()
     where anonymise_le is null and statut in ('acceptee','refusee','expiree') and coalesce(cloture_le, maj_le) < v_limite;
    delete from bail_demande where test and cree_le < p_jour - interval '1 day';
  end if;
  return jsonb_build_object('jour', p_jour, 'simulation', p_dry, 'expirees', v_exp, 'anonymisees', v_anon, 'tests_supprimes', v_test);
end;
$$;
revoke all on function bail_demande_purge(date, boolean) from public, anon, authenticated;
grant execute on function bail_demande_purge(date, boolean) to service_role;
