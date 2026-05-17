-- Migration 138 : Portail Owner — RLS write policies pour staff dcb-compta
-- Problème : owner_visibility_config avait RLS activé mais aucune policy d'écriture
-- pour le rôle anon, or dcb-compta utilise la clé anon pour tous ses appels Supabase.
-- Fix : ajouter INSERT + UPDATE + SELECT pour anon sur owner_visibility_config.

-- ── owner_visibility_config : écriture staff (anon) ──────────────────────────

DROP POLICY IF EXISTS "anon_all_owner_visibility_config" ON owner_visibility_config;
CREATE POLICY "anon_all_owner_visibility_config" ON owner_visibility_config
  FOR ALL TO anon USING (true) WITH CHECK (true);

-- ── Colonnes push_canal / langue si pas encore créées ────────────────────────
ALTER TABLE owner_visibility_config
  ADD COLUMN IF NOT EXISTS push_canal text NOT NULL DEFAULT 'push'
    CHECK (push_canal IN ('push','email','off'));

ALTER TABLE owner_visibility_config
  ADD COLUMN IF NOT EXISTS langue text NOT NULL DEFAULT 'fr'
    CHECK (langue IN ('fr','en'));
