-- Migration 030 : Infos légales par agence — adresse, SIRET, logo, charges
-- Utilisées dans les quittances de loyer, bilans, et autres documents légaux.

ALTER TABLE agency_config
  ADD COLUMN IF NOT EXISTS adresse_ligne1    text,
  ADD COLUMN IF NOT EXISTS adresse_ligne2    text,
  ADD COLUMN IF NOT EXISTS siret             text,
  ADD COLUMN IF NOT EXISTS telephone         text,
  ADD COLUMN IF NOT EXISTS logo_storage_path text,
  ADD COLUMN IF NOT EXISTS charges_nature    text DEFAULT 'forfaitaires';
  -- charges_nature : 'forfaitaires' | 'provisions'

-- Autoriser la mise à jour depuis le frontend (anon key, pas d'auth)
-- Cohérent avec le reste de l'app (open_all_* sur les tables LLD)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'agency_config' AND policyname = 'public_can_update_agency_config'
  ) THEN
    EXECUTE $p$
      CREATE POLICY "public_can_update_agency_config" ON agency_config
        FOR UPDATE TO public USING (true) WITH CHECK (true);
    $p$;
  END IF;
END $$;
