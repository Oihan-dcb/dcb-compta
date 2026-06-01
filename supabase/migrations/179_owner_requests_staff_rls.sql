-- Migration 179 : RLS staff pour owner_requests
-- Problème : seuls les proprios pouvaient lire/modifier leurs propres demandes.
-- DCB staff (PowerHouse) ne pouvait ni lire toutes les demandes ni mettre à jour les statuts.
-- Pattern staff : NOT EXISTS (proprietaire WHERE auth_user_id = auth.uid() AND is_super = false)
-- → staff pur (absent de proprietaire) + oihan (is_super = true) peuvent accéder.

-- SELECT : staff peut voir toutes les demandes
CREATE POLICY "staff_read_all_requests" ON owner_requests
  FOR SELECT TO authenticated
  USING (
    NOT EXISTS (SELECT 1 FROM proprietaire WHERE auth_user_id = auth.uid() AND is_super = false)
  );

-- UPDATE : staff peut modifier statut, réponse, etc.
CREATE POLICY "staff_update_all_requests" ON owner_requests
  FOR UPDATE TO authenticated
  USING (
    NOT EXISTS (SELECT 1 FROM proprietaire WHERE auth_user_id = auth.uid() AND is_super = false)
  )
  WITH CHECK (
    NOT EXISTS (SELECT 1 FROM proprietaire WHERE auth_user_id = auth.uid() AND is_super = false)
  );
