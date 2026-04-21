-- Portail AE — accès authenticated pour le rôle assistante
--
-- Contexte : les tables bien, proprietaire, prestation_type, frais_proprietaire,
-- prestation_hors_forfait et auto_entrepreneur n'avaient de policy SELECT que pour
-- le rôle anon (utilisé par dcb-compta). Quand l'assistante se connecte au portail,
-- sa session bascule en rôle authenticated → 0 lignes retournées silencieusement.
--
-- Fix : ajouter les policies SELECT (et INSERT pour les tables en écriture) pour
-- le rôle authenticated. Les policies anon existantes sont réémises avec
-- DROP IF EXISTS pour éviter tout doublon.

-- ── bien ──────────────────────────────────────────────────────────────────────
ALTER TABLE bien ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_can_select_bien" ON bien;
CREATE POLICY "anon_can_select_bien" ON bien
  FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "authenticated_can_select_bien" ON bien;
CREATE POLICY "authenticated_can_select_bien" ON bien
  FOR SELECT TO authenticated USING (true);

-- ── proprietaire (jointure depuis bien) ───────────────────────────────────────
ALTER TABLE proprietaire ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_can_select_proprietaire" ON proprietaire;
CREATE POLICY "anon_can_select_proprietaire" ON proprietaire
  FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "authenticated_can_select_proprietaire" ON proprietaire;
CREATE POLICY "authenticated_can_select_proprietaire" ON proprietaire
  FOR SELECT TO authenticated USING (true);

-- ── prestation_type ───────────────────────────────────────────────────────────
ALTER TABLE prestation_type ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_can_select_prestation_type" ON prestation_type;
CREATE POLICY "anon_can_select_prestation_type" ON prestation_type
  FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "authenticated_can_select_prestation_type" ON prestation_type;
CREATE POLICY "authenticated_can_select_prestation_type" ON prestation_type
  FOR SELECT TO authenticated USING (true);

-- ── frais_proprietaire ────────────────────────────────────────────────────────
ALTER TABLE frais_proprietaire ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_can_select_frais_proprietaire" ON frais_proprietaire;
CREATE POLICY "anon_can_select_frais_proprietaire" ON frais_proprietaire
  FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "authenticated_can_select_frais_proprietaire" ON frais_proprietaire;
CREATE POLICY "authenticated_can_select_frais_proprietaire" ON frais_proprietaire
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "authenticated_can_insert_frais_proprietaire" ON frais_proprietaire;
CREATE POLICY "authenticated_can_insert_frais_proprietaire" ON frais_proprietaire
  FOR INSERT TO authenticated WITH CHECK (true);

-- ── prestation_hors_forfait ───────────────────────────────────────────────────
ALTER TABLE prestation_hors_forfait ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_can_select_prestation_hors_forfait" ON prestation_hors_forfait;
CREATE POLICY "anon_can_select_prestation_hors_forfait" ON prestation_hors_forfait
  FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "authenticated_can_select_prestation_hors_forfait" ON prestation_hors_forfait;
CREATE POLICY "authenticated_can_select_prestation_hors_forfait" ON prestation_hors_forfait
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "authenticated_can_insert_prestation_hors_forfait" ON prestation_hors_forfait;
CREATE POLICY "authenticated_can_insert_prestation_hors_forfait" ON prestation_hors_forfait
  FOR INSERT TO authenticated WITH CHECK (true);

-- ── auto_entrepreneur ─────────────────────────────────────────────────────────
ALTER TABLE auto_entrepreneur ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_can_select_auto_entrepreneur" ON auto_entrepreneur;
CREATE POLICY "anon_can_select_auto_entrepreneur" ON auto_entrepreneur
  FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "authenticated_can_select_auto_entrepreneur" ON auto_entrepreneur;
CREATE POLICY "authenticated_can_select_auto_entrepreneur" ON auto_entrepreneur
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "authenticated_can_insert_auto_entrepreneur" ON auto_entrepreneur;
CREATE POLICY "authenticated_can_insert_auto_entrepreneur" ON auto_entrepreneur
  FOR INSERT TO authenticated WITH CHECK (true);

-- ── reservation (SELECT pour chargerResasPrestA) ──────────────────────────────
ALTER TABLE reservation ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_can_select_reservation" ON reservation;
CREATE POLICY "anon_can_select_reservation" ON reservation
  FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "authenticated_can_select_reservation" ON reservation;
CREATE POLICY "authenticated_can_select_reservation" ON reservation
  FOR SELECT TO authenticated USING (true);
