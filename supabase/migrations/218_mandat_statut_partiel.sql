-- 218_mandat_statut_partiel.sql
-- Co-signature mandat (Bordeaux) : nouveau statut 'partiel' (un signataire a signé,
-- pas encore tous). Élargit la contrainte CHECK de statut. Déjà appliqué en prod.

alter table mandat_signature drop constraint if exists mandat_signature_statut_chk;
alter table mandat_signature add constraint mandat_signature_statut_chk
  check (statut = any (array['brouillon','envoye','partiel','signe','refuse','expire','annule','remplace']::text[]));
