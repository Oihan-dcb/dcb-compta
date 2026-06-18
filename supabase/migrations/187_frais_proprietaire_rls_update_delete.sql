-- Migration 187 : RLS frais_proprietaire — ajout UPDATE + DELETE pour authenticated
--
-- Bug : seuls SELECT + INSERT étaient couverts (migration 019).
-- UPDATE et DELETE silencieusement bloqués → l'UI affichait "succès" mais rien ne changeait en DB.

DROP POLICY IF EXISTS "authenticated_can_update_frais_proprietaire" ON frais_proprietaire;
CREATE POLICY "authenticated_can_update_frais_proprietaire" ON frais_proprietaire
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "authenticated_can_delete_frais_proprietaire" ON frais_proprietaire;
CREATE POLICY "authenticated_can_delete_frais_proprietaire" ON frais_proprietaire
  FOR DELETE TO authenticated USING (true);
