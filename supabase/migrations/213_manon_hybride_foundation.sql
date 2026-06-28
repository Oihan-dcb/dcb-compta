-- Socle "Manon hybride" (CDI 15h + AE + SAP) — tags pilotant la cascade de répartition.
-- Voir plan complet : note projet project_manon_hybride.
-- (Déjà appliqué en prod via MCP le 2026-06-28 ; fichier ajouté pour traçabilité repo.)

-- Résidences principales : prio 3 de la cascade (ménages de fond facturables en SAP).
alter table bien add column if not exists residence_principale boolean not null default false;
comment on column bien.residence_principale is
  'Bien = résidence principale du proprio (pas un locatif) → ménages facturables en SAP, prio 3 cascade Manon.';

-- Tag manuel "ménage de fond résidence principale" sur une mission (sélection technique manuelle).
alter table mission_menage add column if not exists menage_fond boolean not null default false;
comment on column mission_menage.menage_fond is
  'Ménage de fond (technique) d''une résidence principale — sélectionné manuellement. Prio 3 cascade Manon.';

-- Résultat de la cascade : mission couverte par le pool salarié de Manon (coût = salaire, PAS de débours AE).
alter table mission_menage add column if not exists impute_salaire boolean not null default false;
comment on column mission_menage.impute_salaire is
  'Mission couverte par les 15h salariées de Manon (cascade mensuelle) → exclue du débours AUTO. Le surplus reste en AE.';
