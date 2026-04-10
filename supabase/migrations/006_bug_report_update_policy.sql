-- Permet à la clé anonyme de modifier le statut des bug reports
-- (la clé anon peut déjà insérer via le bouton de signalement)
CREATE POLICY "anon_can_update_bug_report_statut" ON bug_report
  FOR UPDATE TO anon
  USING (true)
  WITH CHECK (true);
