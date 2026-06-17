-- LLD : honoraires DCB = % du loyer CC (charges comprises) — décision Laura 2026-06-11.
-- Remplace le montant figé etudiant.honoraires_dcb par un taux de commission.
-- Taux : 0.10 étudiant/mobilité, 0.08 bail habitation (à l'année), 0.05 Bitxi (exception, override par bien).
-- (Déjà appliqué en prod via MCP le 2026-06-17 ; fichier ajouté pour traçabilité repo.)

alter table etudiant add column if not exists taux_commission numeric(5,4) default 0.10;

update etudiant set taux_commission = 0.10 where type_bail in ('etudiant','mobilite');
update etudiant set taux_commission = 0.08 where type_bail = 'habitation';

-- override Bitxi (par bien) — s'applique quel que soit le type de bail
update etudiant e set taux_commission = 0.05
  from bien b where b.id = e.bien_id and b.hospitable_name ilike '%bitxi%';

update etudiant set taux_commission = 0.10 where taux_commission is null;

comment on column etudiant.taux_commission is
  'Taux de commission DCB appliqué au loyer CC (charges comprises). 0.10 étudiant/mobilité, 0.08 bail habitation (à l''année), 0.05 Bitxi. Remplace le montant figé honoraires_dcb. Laura 2026-06-11.';
