-- Table pour le bilan annuel séquestre : solde bancaire + ajustements manuels
CREATE TABLE IF NOT EXISTS sequestre_bilan (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  agence text NOT NULL DEFAULT 'dcb',
  annee integer NOT NULL,
  solde_bancaire numeric(12,2),       -- solde réel du compte séquestre à la clôture
  compte_cautions numeric(12,2),      -- compte excédent cautions
  ajustements jsonb DEFAULT '[]',     -- [{label, montant, couleur}] lignes manuelles
  updated_at timestamptz DEFAULT now(),
  UNIQUE(agence, annee)
);

ALTER TABLE sequestre_bilan ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bilan_read"  ON sequestre_bilan FOR SELECT USING (true);
CREATE POLICY "bilan_write" ON sequestre_bilan FOR ALL   USING (true);
