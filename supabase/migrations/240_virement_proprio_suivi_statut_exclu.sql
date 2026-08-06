-- Ajoute le statut 'exclu' à virement_proprio_suivi : permet d'exclure un virement
-- (ex. IBAN manquant) du prochain export SEPA sans le marquer faussement 'vire'.
-- La requête d'export (genererSCTVirementsProprios, exportSCT.js) ne lit que
-- statut='a_virer' -- un virement 'exclu' est donc automatiquement écarté, sans
-- toucher au code de génération. Le solde du mois (PageLocationsLongues.jsx)
-- ne compte que 'vire' comme reçu/transféré : un virement 'exclu' reste visible
-- comme non soldé (comportement voulu, l'argent n'a pas bougé).

alter table virement_proprio_suivi drop constraint virement_proprio_suivi_statut_check;
alter table virement_proprio_suivi add constraint virement_proprio_suivi_statut_check
  check (statut = any (array['a_virer', 'vire', 'exclu']));
