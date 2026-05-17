-- Migration 149: RLS owner_visibility_config — élargir à is_super proprios
-- Couvre le cas où l'admin se connecte via son compte proprietaire (is_super)
-- plutôt que son compte auto_entrepreneur

DROP POLICY IF EXISTS "staff_manage_owner_visibility" ON owner_visibility_config;

CREATE POLICY "staff_manage_owner_visibility" ON owner_visibility_config
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM auto_entrepreneur WHERE ae_user_id = auth.uid() AND actif = true)
    OR
    EXISTS (SELECT 1 FROM proprietaire WHERE auth_user_id = auth.uid() AND is_super = true AND actif = true)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM auto_entrepreneur WHERE ae_user_id = auth.uid() AND actif = true)
    OR
    EXISTS (SELECT 1 FROM proprietaire WHERE auth_user_id = auth.uid() AND is_super = true AND actif = true)
  );
