-- Un AE Côte Basque peut travailler pour DCB ET Lauïan → jusqu'à 2 contrats (1 par entité).
-- contrat_agences : agences pour lesquelles l'AE doit signer un contrat (null = dérivé : dcb+lauian).
alter table public.auto_entrepreneur add column if not exists contrat_agences text[];
-- Léa ESCUDIER et Kathy Lerot : DCB uniquement.
update public.auto_entrepreneur set contrat_agences='{dcb}'
  where id in ('ad0828f2-ac9c-4585-85c9-5252b4e65fc7','111f36aa-b8d9-4b95-acdf-44961d15c4e5');
-- Unicité du contrat actif désormais par (ae_id, agence).
drop index if exists ae_contrat_one_active;
create unique index if not exists ae_contrat_one_active on public.ae_contrat(ae_id, agence) where statut in ('pret','signe');
