-- Migration 147: RLS owner_visibility_config — accès staff pour gestion admin
-- Permet aux AE actifs d'insérer/modifier la config de visibilité des proprios

CREATE POLICY "staff_manage_owner_visibility" ON owner_visibility_config
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM auto_entrepreneur WHERE ae_user_id = auth.uid() AND actif = true))
  WITH CHECK (EXISTS (SELECT 1 FROM auto_entrepreneur WHERE ae_user_id = auth.uid() AND actif = true));
