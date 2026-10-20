-- 513 — Disponibilités proposées par le propriétaire, validées par DCB (20/10/2026, extension du circuit 487).
--
-- Demande d'Oïhan (message d'Adrienne, accès partagé VILLA AGERREA) : le propriétaire (titulaire ou accès partagé) peut
-- lui-même CRÉER ses périodes dans le portail (« je suis d'accord pour louer du … au … ») et ses séjours personnels, sans
-- attendre un mail de DCB. Chaque période arrive dans PowerHouse (Accueil › À faire + fiche bien › 🌐 Vente directe), où
-- Oïhan la VALIDE ou la REFUSE (motif optionnel). À la validation, PowerHouse écrit lui-même dans Hospitable
-- (api/_resaManuelle.js) : période louable → nuits ouvertes ; séjour personnel → nuits bloquées. Jamais automatiquement.
--
--   dispo_proprio_periode.validation : proposee (défaut) → validee | refusee ; seules les périodes « validee » comptent pour la
--   vente directe (api/_dispoProprio.js fenetres) — avant 513 une période répondue comptait aussitôt.
--   hospitable_bloque_le / _par : séjour personnel validé → nuits bloquées dans Hospitable (pendant de hospitable_ouvert_le).
--   hospitable_resultat : jours écrits / ignorés lors de la validation (trace).
--   dispo_proprio_demande.origine : 'dcb' (demande envoyée par le bureau) | 'proprietaire' (ouverte depuis le portail).

alter table public.dispo_proprio_periode
  add column if not exists validation text not null default 'proposee',
  add column if not exists valide_le timestamptz,
  add column if not exists valide_par text,
  add column if not exists refus_motif text,
  add column if not exists hospitable_bloque_le timestamptz,
  add column if not exists hospitable_bloque_par text,
  add column if not exists hospitable_resultat jsonb;
do $$ begin
  alter table public.dispo_proprio_periode add constraint dispo_proprio_periode_validation_chk check (validation in ('proposee','validee','refusee'));
exception when duplicate_object then null; end $$;
comment on column public.dispo_proprio_periode.validation is
  'proposee = proposée par le propriétaire, en attente de DCB ; validee = validée par DCB (louable : ouverte dans Hospitable + vente directe ; occupe : bloquée dans Hospitable) ; refusee = refusée (refus_motif). 513.';

alter table public.dispo_proprio_demande
  add column if not exists origine text not null default 'dcb';
do $$ begin
  alter table public.dispo_proprio_demande add constraint dispo_proprio_demande_origine_chk check (origine in ('dcb','proprietaire'));
exception when duplicate_object then null; end $$;

-- Les 2 périodes déjà répondues (B16, GASQ 2027, rien ouvert dans Hospitable) restent « proposee » : elles apparaissent
-- à valider dans À faire ; la vente directe ne les ouvre qu'après validation.

-- VILLA AGERREA (Villa Ahetze) : demande d'ouverture par le propriétaire (Adrienne, accès partagé de P. Grandvoinet).
insert into public.dispo_proprio_bien (bien_id, exige, par, motif)
select id, true, 'claude — 20/10/2026', 'demande d''ouverture par le propriétaire 20/10/2026'
from public.bien where hospitable_id = 'bc19a284-9270-4ad1-bbca-5f391abad6e6'
on conflict (bien_id) do nothing;
