-- Un AE peut travailler pour plusieurs agences (ex. ménage DCB + Lauian) alors que sa fiche
-- auto_entrepreneur.agence reste unique (utilisée ailleurs — facturation, contrat). Ce flag
-- permet à l'onglet Tasks du Portail AE de lui montrer les tâches de toutes les agences plutôt
-- que la seule agence de sa fiche.
alter table auto_entrepreneur
  add column if not exists voit_toutes_agences boolean not null default false;

comment on column auto_entrepreneur.voit_toutes_agences is
  'Si true, l''onglet Tasks du Portail AE affiche les tâches de toutes les agences (dcb+lauian+...) au lieu de la seule agence de la fiche AE.';
