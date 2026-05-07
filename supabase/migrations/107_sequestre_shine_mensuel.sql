-- Table SHINE mensuel : entrées/sorties réelles du compte séquestre
CREATE TABLE IF NOT EXISTS sequestre_shine_mensuel (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  agence text NOT NULL DEFAULT 'dcb',
  mois text NOT NULL,       -- '2025-01'
  credits numeric(12,2),   -- total entrées (Airbnb + Stripe + Booking + Direct)
  debits  numeric(12,2),   -- total sorties (virements proprios, AEs, DCB…)
  solde_fin numeric(12,2), -- solde bancaire fin de mois
  src_airbnb  numeric(12,2),
  src_stripe  numeric(12,2),
  src_booking numeric(12,2),
  src_direct  numeric(12,2),
  UNIQUE(agence, mois)
);
ALTER TABLE sequestre_shine_mensuel ENABLE ROW LEVEL SECURITY;
CREATE POLICY "shine_read"  ON sequestre_shine_mensuel FOR SELECT USING (true);
CREATE POLICY "shine_write" ON sequestre_shine_mensuel FOR ALL   USING (true);

-- Données 2025 extraites du fichier Shine complet
INSERT INTO sequestre_shine_mensuel (agence, mois, credits, debits, solde_fin, src_airbnb, src_stripe, src_booking, src_direct)
VALUES
  ('dcb','2025-01',  8965.09,      0.00,  13687.57,     0.01,  8965.08,     0.00,     0.00),
  ('dcb','2025-02', 30101.32,   1150.85,  42638.04,  6360.60, 21915.70,  1825.02,     0.00),
  ('dcb','2025-03', 28970.46,  20257.83,  51350.67,  7584.00, 18726.92,  2197.92,   461.62),
  ('dcb','2025-04', 47572.34,  22699.49,  76223.52, 25423.71, 17246.49,     0.00,  4902.14),
  ('dcb','2025-05', 41946.75,  43572.88,  74597.39, 27413.82,     0.00,  6585.64,  7947.29),
  ('dcb','2025-06',101956.30,  51925.88, 124627.81, 43948.42, 46876.04,  8231.49,  2900.35),
  ('dcb','2025-07',114337.43,  68237.68, 170727.56, 49071.09, 30368.99,  9545.91, 25351.44),
  ('dcb','2025-08', 81826.48, 111511.29, 141042.75, 57818.44,     0.00, 10174.63, 13833.41),
  ('dcb','2025-09', 46998.18, 110420.41,  77620.52, 17079.80, 25532.15,  4386.23,     0.00),
  ('dcb','2025-10', 30594.62,  78279.87,  29935.27, 22893.38,  1360.00,  6341.24,     0.00),
  ('dcb','2025-11', 19692.00,  34079.72,  15547.55,  8077.37,     0.00,  9360.63,  2254.00),
  ('dcb','2025-12', 29834.99,   7323.45,  38059.09, 10025.91, 12019.73,  3489.35,  4300.00)
ON CONFLICT (agence, mois) DO UPDATE SET
  credits=EXCLUDED.credits, debits=EXCLUDED.debits, solde_fin=EXCLUDED.solde_fin,
  src_airbnb=EXCLUDED.src_airbnb, src_stripe=EXCLUDED.src_stripe,
  src_booking=EXCLUDED.src_booking, src_direct=EXCLUDED.src_direct;

-- Pré-remplir le bilan 2025 avec le solde bancaire réel
INSERT INTO sequestre_bilan (agence, annee, solde_bancaire, compte_cautions, ajustements, updated_at)
VALUES ('dcb', 2025, 38059.09, NULL, '[]', now())
ON CONFLICT (agence, annee) DO UPDATE SET
  solde_bancaire = EXCLUDED.solde_bancaire,
  updated_at = now()
WHERE sequestre_bilan.solde_bancaire IS NULL;
