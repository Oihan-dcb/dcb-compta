-- Migration 003 : champs déduction LOY sur frais_proprietaire
-- Permet de tracer la part effectivement déduite du LOY vs le reliquat à facturer

ALTER TABLE frais_proprietaire
  ADD COLUMN IF NOT EXISTS montant_deduit_loy  integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS montant_reliquat    integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS statut_deduction    text    NOT NULL DEFAULT 'en_attente';

-- Valeurs possibles pour statut_deduction :
--   'en_attente'         : pas encore traité par la facturation
--   'totalement_deduit'  : frais.montant_ttc entièrement absorbé sur LOY
--   'partiellement_deduit' : LOY insuffisant — une partie est dans montant_reliquat
--   'non_deduit'         : LOY nul ou nul disponible — totalité dans montant_reliquat

-- Invariant : montant_deduit_loy + montant_reliquat = montant_ttc (après traitement)
-- Les frais en statut 'brouillon' ou 'a_facturer' ont montant_deduit_loy = 0 par défaut

COMMENT ON COLUMN frais_proprietaire.montant_deduit_loy IS 'Part du frais effectivement déduite du reversement LOY (centimes)';
COMMENT ON COLUMN frais_proprietaire.montant_reliquat   IS 'Part restante non couverte par LOY — à facturer via Evoliz (centimes)';
COMMENT ON COLUMN frais_proprietaire.statut_deduction   IS 'Résultat de la compensation LOY : en_attente | totalement_deduit | partiellement_deduit | non_deduit';
