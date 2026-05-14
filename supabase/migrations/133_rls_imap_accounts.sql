-- Migration 133 : RLS powerhouse_imap_accounts — table sensible (password_enc)
--
-- Contexte :
--   powerhouse_imap_accounts contient password_enc (AES-256-GCM).
--   La policy "imap_accounts_all" ouvrait tout en anon — trop large.
--
-- Choix :
--   - authenticated : couvre les admins DCB qui consultent la table via UI/admin
--   - service_role (Edge Functions, PowerHouse serveur) contourne RLS → pas impacté
--
-- Si PowerHouse lisait cette table via anon key, la requête échouera.
-- Remède : configurer PowerHouse avec SUPABASE_SERVICE_ROLE_KEY pour cet accès.

DROP POLICY IF EXISTS "imap_accounts_all" ON powerhouse_imap_accounts;
DROP POLICY IF EXISTS "authenticated_all_powerhouse_imap_accounts" ON powerhouse_imap_accounts;

CREATE POLICY "authenticated_all_powerhouse_imap_accounts"
  ON powerhouse_imap_accounts
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);
