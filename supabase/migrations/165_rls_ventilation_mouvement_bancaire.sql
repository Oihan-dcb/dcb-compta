-- Migration 165 : RLS authenticated-only pour ventilation et mouvement_bancaire
--
-- Context : migration 101 a créé des policy "anon_all_*" permettant un accès public
-- à ces tables financières sensibles. Migration 132 a corrigé la plupart des tables
-- mais a omis ventilation et mouvement_bancaire.
--
-- Accès via service_role (Edge Functions ventilation-auto, API Vercel portail owner)
-- n'est pas impacté par le RLS → pas de régression.
-- DCB Compta frontend et PowerHouse utilisent des sessions authentifiées → OK.

-- ventilation (données financières — reversements proprios, honoraires DCB)
DROP POLICY IF EXISTS "anon_all_ventilation" ON ventilation;
DROP POLICY IF EXISTS "authenticated_all_ventilation" ON ventilation;
CREATE POLICY "authenticated_all_ventilation" ON ventilation
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- mouvement_bancaire (relevés bancaires — très sensible)
DROP POLICY IF EXISTS "anon_all_mouvement_bancaire" ON mouvement_bancaire;
DROP POLICY IF EXISTS "authenticated_all_mouvement_bancaire" ON mouvement_bancaire;
CREATE POLICY "authenticated_all_mouvement_bancaire" ON mouvement_bancaire
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
