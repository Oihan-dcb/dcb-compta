-- Migration 183 — RLS security fixes (P1)
-- Corrige les policies trop larges introduites dans les migrations 159, 171, 174.
--
-- Problèmes corrigés :
--   159 owner_profile_config  : anon_read_own USING (true) → tous les anon lisaient tout
--   171 rental_contracts      : authenticated_read USING (true) → proprios lisaient tous les contrats
--   174 payment_guarantees    : authenticated_read USING (true) → proprios lisaient données CB

-- ── owner_profile_config (migration 159) ────────────────────────────────────
-- Supprime la policy anon ouverte, remplace par lecture proprio de sa propre ligne.

DROP POLICY IF EXISTS "anon_read_own" ON owner_profile_config;

-- Le proprio lit sa propre config (vérifie que son auth.uid() correspond)
CREATE POLICY "owner_read_own_config" ON owner_profile_config
  FOR SELECT TO authenticated
  USING (
    proprietaire_id IN (
      SELECT id FROM proprietaire WHERE auth_user_id = auth.uid()
    )
  );

-- Staff lit tout (pattern standard : user non-proprio = staff)
CREATE POLICY "staff_read_all_owner_config" ON owner_profile_config
  FOR SELECT TO authenticated
  USING (
    NOT EXISTS (
      SELECT 1 FROM proprietaire WHERE auth_user_id = auth.uid() AND is_super = false
    )
  );

-- ── rental_contracts (migration 171) ────────────────────────────────────────
-- Supprime la policy authenticated trop large, remplace par staff-only.

DROP POLICY IF EXISTS "authenticated_read" ON rental_contracts;

CREATE POLICY "staff_read_contracts" ON rental_contracts
  FOR SELECT TO authenticated
  USING (
    NOT EXISTS (
      SELECT 1 FROM proprietaire WHERE auth_user_id = auth.uid() AND is_super = false
    )
  );

-- ── payment_guarantees (migration 174) ──────────────────────────────────────
-- Données CB sensibles : staff uniquement, jamais les proprios.

DROP POLICY IF EXISTS "authenticated_read" ON payment_guarantees;

CREATE POLICY "staff_read_guarantees" ON payment_guarantees
  FOR SELECT TO authenticated
  USING (
    NOT EXISTS (
      SELECT 1 FROM proprietaire WHERE auth_user_id = auth.uid() AND is_super = false
    )
  );

-- ── contract_payments ────────────────────────────────────────────────────────
-- La table n'avait pas de policy authenticated explicite mais par sécurité on s'assure.
-- (Si pas de policy existante, cette DROP est no-op.)

DROP POLICY IF EXISTS "authenticated_read" ON contract_payments;

CREATE POLICY "staff_read_contract_payments" ON contract_payments
  FOR SELECT TO authenticated
  USING (
    NOT EXISTS (
      SELECT 1 FROM proprietaire WHERE auth_user_id = auth.uid() AND is_super = false
    )
  );

-- ── contract_events ──────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "authenticated_read" ON contract_events;

CREATE POLICY "staff_read_contract_events" ON contract_events
  FOR SELECT TO authenticated
  USING (
    NOT EXISTS (
      SELECT 1 FROM proprietaire WHERE auth_user_id = auth.uid() AND is_super = false
    )
  );
