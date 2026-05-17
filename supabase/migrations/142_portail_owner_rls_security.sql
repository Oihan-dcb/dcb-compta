-- Migration 142 : Portail Owner — Corrections RLS sécurité
-- Problèmes corrigés :
--   1. proprietaire : anon_all_proprietaire (migration 101) permettait update auth_user_id arbitraire
--   2. owner_visibility_config : policies FOR ALL USING (true) permettaient write cross-proprio
--   3. owner_chat_rooms / owner_chat_messages : policies permissives exposaient toutes les conversations
-- Principe : les writes sensibles passent par service_role (Vercel API), pas par anon/authenticated.

-- ─── 1. proprietaire ─────────────────────────────────────────────────────────
-- Supprimer la policy anon_all trop permissive (créée par migration 101)
DROP POLICY IF EXISTS "anon_all_proprietaire" ON proprietaire;

-- UPDATE restreint : un proprio authentifié ne peut lier que son propre auth.uid()
-- sur la ligne dont l'email correspond à son email Supabase auth
CREATE POLICY "proprio_link_own_auth_user" ON proprietaire
  FOR UPDATE TO authenticated
  USING (email = (SELECT email FROM auth.users WHERE id = auth.uid()))
  WITH CHECK (auth_user_id = auth.uid());

-- Les SELECT anon/authenticated restent (migration 019 : anon_can_select / authenticated_can_select)
-- Les INSERT/DELETE restent service_role uniquement

-- ─── 2. owner_visibility_config ──────────────────────────────────────────────
-- Supprimer les policies permissives (migration 138)
DROP POLICY IF EXISTS "anon_all_owner_visibility_config" ON owner_visibility_config;
DROP POLICY IF EXISTS "authenticated_all_owner_visibility_config" ON owner_visibility_config;

-- La policy SELECT "proprio_read_own_visibility" (migration 137) reste en place.
-- Les writes se font uniquement via service_role (Vercel API _auth.js utilise SUPABASE_SERVICE_KEY).

-- ─── 3. owner_chat_rooms ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS "auth_all_owner_chat_rooms" ON owner_chat_rooms;
DROP POLICY IF EXISTS "anon_all_owner_chat_rooms" ON owner_chat_rooms;

-- SELECT : proprio voit ses rooms support + broadcast de son agence
CREATE POLICY "proprio_read_own_chat_rooms" ON owner_chat_rooms
  FOR SELECT TO authenticated
  USING (
    type = 'broadcast'
    OR (
      type = 'support'
      AND proprio_id IN (
        SELECT id FROM proprietaire WHERE auth_user_id = auth.uid()
      )
    )
  );

-- INSERT/UPDATE/DELETE : service_role uniquement (API Vercel chat-rooms.js)

-- ─── 4. owner_chat_messages ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "auth_all_owner_chat_messages" ON owner_chat_messages;
DROP POLICY IF EXISTS "anon_all_owner_chat_messages" ON owner_chat_messages;

-- SELECT : proprio voit les messages de ses rooms uniquement
-- Cette policy s'applique aussi au Realtime : Supabase ne diffuse que les rows accessibles
CREATE POLICY "proprio_read_own_chat_messages" ON owner_chat_messages
  FOR SELECT TO authenticated
  USING (
    room_id IN (
      SELECT id FROM owner_chat_rooms
      WHERE type = 'broadcast'
      OR (
        type = 'support'
        AND proprio_id IN (
          SELECT id FROM proprietaire WHERE auth_user_id = auth.uid()
        )
      )
    )
  );

-- INSERT/UPDATE/DELETE : service_role uniquement (API Vercel chat-send.js, chat-delete.js)
