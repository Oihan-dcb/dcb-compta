-- 536 — Réponse automatique aux avis voyageurs (22/10/2026, demande Oïhan).
-- Le cron PowerHouse api/cron-avis-reponse-auto.js rédige le brouillon IA de chaque avis récent sans réponse, puis publie
-- les réponses aux avis POSITIFS 7 jours après la rédaction (jamais les négatifs : note ≤ 3 ou mots négatifs).
-- Interrupteurs Vercel : AVIS_REPONSE_AUTO_REDACTION / AVIS_REPONSE_AUTO_PUBLICATION (= « actif » ; sinon essai).
alter table public.avis_reponse
  add column if not exists auto_redige_le            timestamptz,  -- brouillon écrit par le cron (et non sur clic)
  add column if not exists publication_prevue_le     timestamptz,  -- publication automatique prévue (positifs seulement)
  add column if not exists publication_suspendue_le  timestamptz,  -- « Ne pas publier » : la publication auto ne part pas
  add column if not exists publication_suspendue_par text,
  add column if not exists publication_reservee_le   timestamptz;  -- réservation juste avant l'appel Hospitable (une seule publication)

comment on column public.avis_reponse.publication_prevue_le is 'Publication automatique prévue (rédaction auto + 7 j), avis positifs seulement ; null = jamais automatique (536).';
comment on column public.avis_reponse.publication_reservee_le is 'Posée par un UPDATE conditionnel juste avant l''appel Hospitable : deux publications simultanées sont impossibles (536).';

-- Le cron cherche les réponses planifiées dont la date est passée
create index if not exists avis_reponse_publication_prevue_idx on public.avis_reponse (publication_prevue_le)
  where publication_prevue_le is not null and publie_le is null;

-- Retour arrière :
--   alter table public.avis_reponse drop column auto_redige_le, drop column publication_prevue_le,
--     drop column publication_suspendue_le, drop column publication_suspendue_par, drop column publication_reservee_le;
