-- Migration 190 : ajouter policy anon ALL sur prestation_hors_forfait
-- Les policies existantes sont uniquement pour 'authenticated', mais l'app
-- utilise la clé anon sans session. Toutes les écritures (INSERT/UPDATE/DELETE)
-- depuis le client échouaient silencieusement.
-- Pattern identique à frais_proprietaire (migration 187).

CREATE POLICY anon_all_prestation_hors_forfait
  ON prestation_hors_forfait
  FOR ALL
  TO anon
  USING (true)
  WITH CHECK (true);
