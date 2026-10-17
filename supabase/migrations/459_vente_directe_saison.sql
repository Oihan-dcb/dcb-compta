-- 459 — Saison de vente directe par bien (17/10/2026, décision Oïhan pour BELEZIA, GASQ, ZURBIAC : « oui mais que l'été »).
--
-- Fenêtre RÉCURRENTE chaque année (jour/mois), ex. 06-01 → 09-30. NULL / NULL = toute l'année (comportement inchangé).
-- Effets (moteur api/_direct.js de dcb-planning) :
--   · hors saison, aucune nuit n'est vendable en direct (calendrier public grisé, devis refusé « hors_saison ») ;
--   · un séjour doit être ENTIÈREMENT dans la saison (toutes ses nuits) ;
--   · la saison S'AJOUTE aux disponibilités Hospitable (une nuit bloquée dans Hospitable reste bloquée) ;
--   · un bien « hors location » (bien.hors_location) n'est publiable en vente directe QUE s'il a une saison
--     (sans saison : jamais publiable, règle inchangée). statut_location / hors_location ne sont pas modifiés.
-- Saison à cheval sur deux années (ex. 12-15 → 01-15) acceptée : début > fin = la saison passe le 31/12.

alter table public.bien_vente_directe
  add column if not exists saison_debut text,
  add column if not exists saison_fin text;

alter table public.bien_vente_directe drop constraint if exists bien_vente_directe_saison_chk;
alter table public.bien_vente_directe add constraint bien_vente_directe_saison_chk check (
  (saison_debut is null and saison_fin is null)
  or (saison_debut ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
      and saison_fin ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
      and saison_debut not in ('02-30', '02-31', '04-31', '06-31', '09-31', '11-31')
      and saison_fin not in ('02-30', '02-31', '04-31', '06-31', '09-31', '11-31')
      and saison_debut <> saison_fin)
);

comment on column public.bien_vente_directe.saison_debut is 'Saison de vente directe : premier jour vendable chaque année, « MM-JJ » (NULL = toute l''année). Migration 459.';
comment on column public.bien_vente_directe.saison_fin is 'Saison de vente directe : dernière NUIT vendable chaque année, « MM-JJ » (départ possible le lendemain). Migration 459.';
