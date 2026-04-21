-- Migration 027 : RLS public sur les tables LLD
--
-- Les tables LLD (024) avaient uniquement une policy 'authenticated'.
-- L'app tourne sans session Supabase Auth (anon key) → rôle 'public'.
-- Alignement avec le pattern des autres tables (open_all_*).

CREATE POLICY "open_all_etudiant"             ON etudiant              FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "open_all_loyer_suivi"          ON loyer_suivi           FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "open_all_virement_proprio_suivi" ON virement_proprio_suivi FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "open_all_caution_suivi"        ON caution_suivi         FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "open_all_etudiant_document"    ON etudiant_document     FOR ALL TO public USING (true) WITH CHECK (true);
