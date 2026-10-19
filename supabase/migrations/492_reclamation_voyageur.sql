-- 492 : Réclamations voyageurs (dégâts, saleté, casse…) — circuit PowerHouse « 📂 Réclamation » (19/10/2026).
--
-- Demande d'Oïhan (audit docs/audit-remboursement-degats-2026-10.md, dcb-planning) : un DOSSIER par séjour, créé
-- automatiquement depuis un signalement terrain, qui reproduit SA façon de faire :
--   1. entre H+24 et H+48 après le départ : message « question » au voyageur (au-delà de 48 h : sans valeur pour Airbnb) ;
--   2. 48 h avant la fin de la fenêtre des avis (14 jours après le départ) : la DEMANDE DE REMBOURSEMENT est faite à la
--      main par le bureau (Centre de résolution Airbnb), au plus tard 2 h avant la fin, avec facture IMAGE + photos ;
--   3. suivi jusqu'à l'encaissement (remboursements Airbnb CLA-/CLSF- rapprochés), puis compta selon la répartition.
-- Réservation directe (et Booking avec carte signée) : notification art. 11 du contrat puis débit de la carte de garantie
-- 7 jours après (même passerelle que la pénalité de départ tardif, interrupteur RECLAMATION_DEBIT, ESSAI par défaut).
--
-- Tables en RLS SANS politique : service_role seul (l'API PowerHouse api/reclamation.js contrôle les droits).

create table if not exists public.reclamation_reglage (
  agence               text primary key check (agence in ('dcb', 'lauian')),
  -- Barème : [{cle, libelle, mode: heure|lot|forfait|forfait_pct|reel, prix_cts, min_cts, pct, beneficiaire: agence|proprietaire,
  --           piece_requise, actif}] — modifiable par Oïhan dans PowerHouse (⚙ Réglages des réclamations).
  bareme               jsonb not null,
  seuil_min_centimes   integer not null default 1000,
  tva_indemnite        boolean not null default false,  -- false = indemnité hors champ TVA (à confirmer par l'expert-comptable)
  mention_tva          text,
  signature            text,
  maj_le               timestamptz not null default now(),
  maj_par              text
);
alter table public.reclamation_reglage enable row level security;

create sequence if not exists public.reclamation_facture_seq;

create table if not exists public.reclamation_voyageur (
  id                        uuid primary key default gen_random_uuid(),
  reservation_id            uuid not null references public.reservation(id) on delete cascade,
  reservation_code          text,
  resa_hospitable_id        text,
  bien_id                   uuid,
  agence                    text not null default 'dcb',
  plateforme                text,
  depart_le                 timestamptz,                -- départ effectif (reservation_heure_v.fin)
  signalement_ids           uuid[] not null default '{}',
  origine                   text not null default 'signalement', -- signalement | manuel
  statut                    text not null default 'a_qualifier' check (statut in (
                              'a_qualifier',   -- créé depuis un signalement : le bureau décide s'il y a réclamation
                              'preparation',   -- réclamation décidée, question pas encore envoyée
                              'question_envoyee',
                              'reponse',       -- réponse du voyageur notée (aveu / contestation / pas de réponse)
                              'demande_faite', -- demande de remboursement faite (Airbnb) / notification envoyée (direct)
                              'encaissee', 'refusee', 'abandonnee')),
  langue                    text not null default 'fr' check (langue in ('fr', 'en', 'es')),
  constat                   text,                       -- ce qui a été constaté, en clair (repris dans les textes)
  lignes                    jsonb not null default '[]',-- [{cle, libelle, quantite, unite_cts, montant_cts, beneficiaire, piece_url, note}]
  total_centimes            integer not null default 0,
  part_agence_centimes      integer not null default 0,
  part_proprio_centimes     integer not null default 0,
  question_texte            text,
  question_photos           text[] not null default '{}',
  question_programmee_le    timestamptz,                -- envoi programmé (validé par le bureau) — cron api/cron-reclamations
  question_valide_par       text,
  question_envoyee_le       timestamptz,
  question_mode             text,                       -- hospitable | manuel
  question_message_ref      text,
  question_essai            jsonb,
  reponse_type              text check (reponse_type in ('aveu', 'contestation', 'pas_de_reponse', 'paiement_propose')),
  reponse_note              text,
  reponse_le                timestamptz,
  demande_texte             text,
  demande_texte_en          text,
  demande_faite_le          timestamptz,
  demande_montant_centimes  integer,
  demande_ref               text,                       -- n° de demande Airbnb / Booking
  demande_par               text,
  facture_numero            text unique,
  facture_le                date,
  notifie_le                date,                       -- direct : notification écrite (art. 11) envoyée
  stripe_payment_intent_id  text,
  debit                     jsonb,
  encaisse_centimes         integer not null default 0,
  encaisse_le               timestamptz,
  encaisse_source           text,                       -- airbnb | booking | carte | manuel
  ajustement_id             uuid,                       -- reservation_ajustement rapproché (CLA- / CLSF-)
  compta_statut             text,                       -- null | appliquee | a_faire | bloquee
  compta                    jsonb,
  journal                   jsonb not null default '[]',
  note                      text,
  abandon_motif             text,
  cree_le                   timestamptz not null default now(),
  cree_par_label            text,
  maj_le                    timestamptz not null default now()
);
create unique index if not exists reclamation_voyageur_une_active
  on public.reclamation_voyageur(reservation_id) where statut not in ('abandonnee', 'refusee');
create index if not exists reclamation_voyageur_statut_idx on public.reclamation_voyageur(statut);
create index if not exists reclamation_voyageur_sig_idx on public.reclamation_voyageur using gin (signalement_ids);
alter table public.reclamation_voyageur enable row level security;

-- Barème de départ = forfaits DÉJÀ écrits à l'art. 11 du contrat saisonnier (saleté 80 € min, linge 30 €/lot, déchets
-- 50 €, animaux / sur-occupation 100 € + 5 % du séjour) + temps de ménage en plus au taux AE (25 €/h, ex. EKIA 30 min
-- = 12,50 €). Fumée / fête / casse / objet / clés = frais réels justifiés. Répartition par défaut (décision Oïhan à
-- confirmer) : ménage / linge / déchets / fumée / animaux / fête → agence (c'est DCB qui paie le temps en plus) ;
-- casse / objet manquant / clés → propriétaire.
insert into public.reclamation_reglage (agence, bareme, seuil_min_centimes, tva_indemnite, mention_tva, signature)
select a, '[
  {"cle":"menage_supplementaire","libelle":"Ménage supplémentaire (temps passé en plus du forfait)","mode":"heure","prix_cts":2500,"min_cts":0,"beneficiaire":"agence","actif":true},
  {"cle":"salete_avancee","libelle":"Logement laissé dans un état de saleté avancée (remise en état)","mode":"reel","prix_cts":8000,"min_cts":8000,"beneficiaire":"agence","actif":true},
  {"cle":"linge_souille","libelle":"Linge fortement taché / souillé (traitement ou remplacement)","mode":"lot","prix_cts":3000,"min_cts":3000,"beneficiaire":"agence","actif":true},
  {"cle":"dechets","libelle":"Déchets non évacués (enlèvement)","mode":"forfait","prix_cts":5000,"min_cts":5000,"beneficiaire":"agence","actif":true},
  {"cle":"animaux_suroccupation","libelle":"Animal non déclaré / personnes non prévues","mode":"forfait_pct","prix_cts":10000,"pct":5,"min_cts":10000,"beneficiaire":"agence","actif":true},
  {"cle":"fumee","libelle":"Odeur de tabac / fumée à l''intérieur (traitement)","mode":"reel","prix_cts":0,"min_cts":0,"beneficiaire":"agence","actif":true},
  {"cle":"fete","libelle":"Fête / nuisances (remise en état)","mode":"reel","prix_cts":0,"min_cts":0,"beneficiaire":"agence","actif":true},
  {"cle":"casse","libelle":"Casse / dégradation (sur facture ou devis)","mode":"reel","prix_cts":0,"min_cts":0,"beneficiaire":"proprietaire","piece_requise":true,"actif":true},
  {"cle":"objet_manquant","libelle":"Objet manquant (prix de remplacement)","mode":"reel","prix_cts":0,"min_cts":0,"beneficiaire":"proprietaire","piece_requise":true,"actif":true},
  {"cle":"cles","libelle":"Clés / badge / télécommande non restitués","mode":"reel","prix_cts":0,"min_cts":0,"beneficiaire":"proprietaire","piece_requise":true,"actif":true}
]'::jsonb, 1000, false,
  'Indemnité de remise en état — hors champ de la TVA (absence de contrepartie).',
  case a when 'lauian' then 'Laura' else 'Oïhan' end
from unnest(array['dcb', 'lauian']) a
on conflict (agence) do nothing;

-- ── Rattachement d'un signalement au séjour qui vient de partir ───────────────────────────────────────────────────────
-- Audit 19/10/2026 : 36/40 signalements sans code de réservation. Ordre : mission d'origine (mission_menage.reservation_id,
-- séjour déjà parti) → code saisi → dernier départ du logement dans les 7 jours avant la date du signalement.
create or replace function public.reclamation_sejour_signalement(p_mission uuid, p_ref text, p_toolbox uuid, p_jour date)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare v uuid; v_bien uuid;
begin
  if p_mission is not null then
    select r.id into v from mission_menage m join reservation r on r.id = m.reservation_id
     where m.id = p_mission and r.departure_date <= coalesce(m.date_mission, p_jour) and coalesce(r.owner_stay, false) = false limit 1;
    if v is not null then return v; end if;
  end if;
  if nullif(trim(p_ref), '') is not null then
    select id into v from reservation where code = trim(p_ref) limit 1;
    if v is not null then return v; end if;
  end if;
  select bien_id into v_bien from bien_toolbox where id = p_toolbox;
  if v_bien is null then return null; end if;
  select id into v from reservation
   where bien_id = v_bien and departure_date between p_jour - 7 and p_jour
     and coalesce(owner_stay, false) = false and coalesce(final_status, '') not in ('cancelled', 'not accepted', 'declined')
     and sejour_hors_id is null
   order by departure_date desc, departure_date - arrival_date desc limit 1;
  return v;
end $$;

-- Complète le signalement (code, voyageur, départ) quand le portail ne l'a pas fait — jamais d'écrasement.
create or replace function public.reclamation_signalement_completer() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_r uuid; r record;
begin
  if new.reservation_ref is not null and new.client_name is not null and new.checkout_date is not null then return new; end if;
  v_r := reclamation_sejour_signalement(new.mission_id, new.reservation_ref, new.bien_id,
           coalesce(new.checkout_date, (coalesce(new.created_at, now()) at time zone 'Europe/Paris')::date));
  if v_r is null then return new; end if;
  select code, guest_name, departure_date into r from reservation where id = v_r;
  new.reservation_ref := coalesce(new.reservation_ref, r.code);
  new.client_name := coalesce(new.client_name, r.guest_name);
  new.checkout_date := coalesce(new.checkout_date, r.departure_date);
  return new;
exception when others then return new;
end $$;
drop trigger if exists trg_reclamation_signalement_completer on public.signalements;
create trigger trg_reclamation_signalement_completer before insert on public.signalements
  for each row execute function public.reclamation_signalement_completer();

-- Crée (ou complète) le dossier du séjour — statut « à qualifier » : RIEN n'est envoyé, le bureau décide.
create or replace function public.reclamation_depuis_signalement(p_sig uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare s record; v_r uuid; r record; v_id uuid; v_agence text; v_lang text;
begin
  select * into s from signalements where id = p_sig;
  if s.id is null or s.type not in ('degat', 'salete') then return null; end if;
  select id into v_id from reclamation_voyageur where p_sig = any(signalement_ids) limit 1;
  if v_id is not null then return v_id; end if;
  v_r := reclamation_sejour_signalement(s.mission_id, s.reservation_ref, s.bien_id,
           coalesce(s.checkout_date, (s.created_at at time zone 'Europe/Paris')::date));
  if v_r is null then return null; end if;
  select rr.*, b.agence b_agence, h.fin h_fin into r from reservation rr left join bien b on b.id = rr.bien_id
    left join lateral (select fin from reservation_heure_v v where v.reservation_id = rr.id limit 1) h on true where rr.id = v_r;
  if coalesce(r.owner_stay, false) then return null; end if;
  v_agence := case when r.b_agence = 'lauian' then 'lauian' else 'dcb' end;
  v_lang := case when lower(left(coalesce(r.guest_locale, ''), 2)) in ('fr', 'en', 'es') then lower(left(r.guest_locale, 2))
                 when coalesce(r.guest_locale, '') = '' then 'fr' else 'en' end;
  select id into v_id from reclamation_voyageur where reservation_id = v_r and statut not in ('abandonnee', 'refusee') limit 1;
  if v_id is not null then
    update reclamation_voyageur set signalement_ids = array_append(signalement_ids, p_sig), maj_le = now(),
      journal = journal || jsonb_build_array(jsonb_build_object('le', now(), 'quoi', 'signalement_ajoute', 'signalement_id', p_sig, 'par', coalesce(s.created_by_name, 'terrain')))
     where id = v_id;
    return v_id;
  end if;
  insert into reclamation_voyageur (reservation_id, reservation_code, resa_hospitable_id, bien_id, agence, plateforme, depart_le,
                                    signalement_ids, origine, langue, constat, cree_par_label, journal)
  values (v_r, r.code, r.hospitable_id, r.bien_id, v_agence, lower(coalesce(r.platform, '')),
          coalesce(r.h_fin, (r.departure_date + time '10:00') at time zone 'Europe/Paris'),
          array[p_sig], 'signalement', v_lang, nullif(left(s.description, 500), ''), coalesce(s.created_by_name, 'terrain'),
          jsonb_build_array(jsonb_build_object('le', now(), 'quoi', 'cree_depuis_signalement', 'signalement_id', p_sig, 'par', coalesce(s.created_by_name, 'terrain'))))
  on conflict do nothing
  returning id into v_id;
  return v_id;
exception when others then return null;
end $$;

create or replace function public.reclamation_signalement_dossier() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform reclamation_depuis_signalement(new.id);
  return new;
exception when others then return new;
end $$;
drop trigger if exists trg_reclamation_signalement_dossier on public.signalements;
create trigger trg_reclamation_signalement_dossier after insert on public.signalements
  for each row execute function public.reclamation_signalement_dossier();

-- Lien avec l'outil « avis sur les voyageurs » (autre chantier) : tant qu'une réclamation est en cours et que la demande de
-- remboursement n'est pas faite, NE PAS publier l'avis sur le voyageur (il ne doit pas être alerté avant la demande, ni
-- pouvoir répondre par un avis de représailles : la demande est faite juste avant la fin de la fenêtre des avis).
create or replace function public.reclamation_retenir_avis(p_reservation_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((select jsonb_build_object('retenir', true, 'dossier_id', id, 'statut', statut,
           'raison', 'Réclamation en cours : publier l''avis seulement après la demande de remboursement (ou la laisser expirer).',
           'fin_fenetre', depart_le + interval '14 days')
     from reclamation_voyageur where reservation_id = p_reservation_id
      and statut in ('a_qualifier', 'preparation', 'question_envoyee', 'reponse') limit 1),
   jsonb_build_object('retenir', false));
$$;
revoke all on function public.reclamation_retenir_avis(uuid) from public, anon;
revoke all on function public.reclamation_depuis_signalement(uuid) from public, anon, authenticated;
revoke all on function public.reclamation_sejour_signalement(uuid, text, uuid, date) from public, anon, authenticated;

-- Reprise : signalements dégât / saleté dont le départ date de moins de 14 jours (fenêtre Airbnb encore ouverte).
select public.reclamation_depuis_signalement(s.id)
  from public.signalements s
 where s.type in ('degat', 'salete') and s.created_at >= now() - interval '16 days' and coalesce(s.description, '') <> 'Test';

-- 492b : texte du constat présenté au VOYAGEUR (distinct de `constat` = mots de l'AE, interne) + numéro de facture.
alter table public.reclamation_voyageur add column if not exists constat_voyageur text;
create or replace function public.nextval_reclamation_facture() returns bigint
language sql security definer set search_path = public as $$ select nextval('public.reclamation_facture_seq') $$;
revoke all on function public.nextval_reclamation_facture() from public, anon, authenticated;

-- 492c : langue du dossier = langue des messages du voyageur (Hospitable), puis locale de la résa, sinon français.
create or replace function public.reclamation_langue_sejour(p_hosp text, p_locale text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select case when l in ('fr','en','es') then l else 'en' end from (
       select lower(left(language, 2)) l, count(*) n from hospitable_messages
        where reservation_id = p_hosp and sender_type = 'guest' and coalesce(language, '') <> '' group by 1 order by 2 desc limit 1) x),
    case when lower(left(coalesce(p_locale, ''), 2)) in ('fr','en','es') then lower(left(p_locale, 2))
         when coalesce(p_locale, '') = '' then 'fr' else 'en' end);
$$;
revoke all on function public.reclamation_langue_sejour(text, text) from public, anon, authenticated;

create or replace function public.reclamation_depuis_signalement(p_sig uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare s record; v_r uuid; r record; v_id uuid; v_agence text; v_lang text;
begin
  select * into s from signalements where id = p_sig;
  if s.id is null or s.type not in ('degat', 'salete') then return null; end if;
  select id into v_id from reclamation_voyageur where p_sig = any(signalement_ids) limit 1;
  if v_id is not null then return v_id; end if;
  v_r := reclamation_sejour_signalement(s.mission_id, s.reservation_ref, s.bien_id,
           coalesce(s.checkout_date, (s.created_at at time zone 'Europe/Paris')::date));
  if v_r is null then return null; end if;
  select rr.*, b.agence b_agence, h.fin h_fin into r from reservation rr left join bien b on b.id = rr.bien_id
    left join lateral (select fin from reservation_heure_v v where v.reservation_id = rr.id limit 1) h on true where rr.id = v_r;
  if coalesce(r.owner_stay, false) then return null; end if;
  v_agence := case when r.b_agence = 'lauian' then 'lauian' else 'dcb' end;
  v_lang := reclamation_langue_sejour(r.hospitable_id, r.guest_locale);
  select id into v_id from reclamation_voyageur where reservation_id = v_r and statut not in ('abandonnee', 'refusee') limit 1;
  if v_id is not null then
    update reclamation_voyageur set signalement_ids = array_append(signalement_ids, p_sig), maj_le = now(),
      journal = journal || jsonb_build_array(jsonb_build_object('le', now(), 'quoi', 'signalement_ajoute', 'signalement_id', p_sig, 'par', coalesce(s.created_by_name, 'terrain')))
     where id = v_id;
    return v_id;
  end if;
  insert into reclamation_voyageur (reservation_id, reservation_code, resa_hospitable_id, bien_id, agence, plateforme, depart_le,
                                    signalement_ids, origine, langue, constat, cree_par_label, journal)
  values (v_r, r.code, r.hospitable_id, r.bien_id, v_agence, lower(coalesce(r.platform, '')),
          coalesce(r.h_fin, (r.departure_date + time '10:00') at time zone 'Europe/Paris'),
          array[p_sig], 'signalement', v_lang, nullif(left(s.description, 500), ''), coalesce(s.created_by_name, 'terrain'),
          jsonb_build_array(jsonb_build_object('le', now(), 'quoi', 'cree_depuis_signalement', 'signalement_id', p_sig, 'par', coalesce(s.created_by_name, 'terrain'))))
  on conflict do nothing
  returning id into v_id;
  return v_id;
exception when others then return null;
end $$;
update public.reclamation_voyageur set langue = public.reclamation_langue_sejour(resa_hospitable_id, null) where question_texte is null;
