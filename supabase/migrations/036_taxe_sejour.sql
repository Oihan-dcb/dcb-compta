-- Migration 036 : module taxe de séjour
--
-- Ajoute classification sur bien + table taxe_sejour_config
-- pré-remplie avec les tarifs Biarritz 2026 (délibération jan 2026)

-- 1. Champ classification sur bien
ALTER TABLE bien ADD COLUMN IF NOT EXISTS classification text NOT NULL DEFAULT 'non_classe';

-- 2. Table de configuration des taux
CREATE TABLE IF NOT EXISTS taxe_sejour_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agence text NOT NULL DEFAULT 'dcb',
  commune text NOT NULL,                    -- ex: 'Biarritz', 'Bordeaux'
  classification text NOT NULL,             -- ex: 'non_classe', '1_etoile', …
  type_calcul text NOT NULL,                -- 'pourcentage' | 'forfait'
  taux_pct numeric,                         -- pour non_classe : 5 (%)
  plafond_ht numeric,                       -- plafond HT avant coeff (ex: 4.90)
  tarif_pers_nuit numeric,                  -- pour classé : montant TTC final
  coeff_additionnel numeric NOT NULL DEFAULT 1.44, -- 1 + dept% + region%
  annee integer NOT NULL DEFAULT 2026,
  notes text,
  created_at timestamptz DEFAULT now(),
  UNIQUE (agence, commune, classification, annee)
);

ALTER TABLE taxe_sejour_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open_all_taxe_config" ON taxe_sejour_config
  FOR ALL TO public USING (true) WITH CHECK (true);

-- 3. Tarifs Biarritz 2026 (source : délibération Biarritz jan 2026, taxe.3douest.com)
--    Taxes additionnelles : +10% département + +34% région = +44%
--    Tarifs forfaitaires déjà TTC (taxes incluses)
--    Non classé : 5% × prix_nuit_HT, plafonné 4.90€ HT, puis × 1.44
INSERT INTO taxe_sejour_config (agence, commune, classification, type_calcul, taux_pct, plafond_ht, tarif_pers_nuit, coeff_additionnel, annee, notes)
VALUES
  ('dcb', 'Biarritz', 'non_classe',  'pourcentage', 5,    4.90, null, 1.44, 2026, 'En attente de classement ou sans classement'),
  ('dcb', 'Biarritz', '1_etoile',   'forfait',      null, null, 1.15, 1.44, 2026, '1★ + chambres d''hôtes + auberges collectives'),
  ('dcb', 'Biarritz', '2_etoiles',  'forfait',      null, null, 1.44, 1.44, 2026, '2★'),
  ('dcb', 'Biarritz', '3_etoiles',  'forfait',      null, null, 2.45, 1.44, 2026, '3★'),
  ('dcb', 'Biarritz', '4_etoiles',  'forfait',      null, null, 3.74, 1.44, 2026, '4★'),
  ('dcb', 'Biarritz', '5_etoiles',  'forfait',      null, null, 5.18, 1.44, 2026, '5★')
ON CONFLICT (agence, commune, classification, annee) DO NOTHING;

-- Index
CREATE INDEX IF NOT EXISTS idx_taxe_config_commune ON taxe_sejour_config (agence, commune, annee);
CREATE INDEX IF NOT EXISTS idx_bien_classification ON bien (classification);
