-- Migration 146 : Fix RLS owner_chat — identifier staff via auto_entrepreneur
-- Problème : policies 144/145 testaient NOT EXISTS (proprietaire WHERE auth_user_id = uid())
-- mais des users peuvent être dans les DEUX tables (ex: Oihan = proprio + staff AE)
-- Fix : staff = EXISTS (auto_entrepreneur WHERE ae_user_id = auth.uid() AND actif = true)

-- ── owner_chat_rooms ─────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "staff_read_all_chat_rooms" ON owner_chat_rooms;
CREATE POLICY "staff_read_all_chat_rooms" ON owner_chat_rooms
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM auto_entrepreneur WHERE ae_user_id = auth.uid() AND actif = true)
  );

DROP POLICY IF EXISTS "staff_insert_chat_rooms" ON owner_chat_rooms;
CREATE POLICY "staff_insert_chat_rooms" ON owner_chat_rooms
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM auto_entrepreneur WHERE ae_user_id = auth.uid() AND actif = true)
  );

-- ── owner_chat_messages ──────────────────────────────────────────────────────

DROP POLICY IF EXISTS "staff_read_all_chat_messages" ON owner_chat_messages;
CREATE POLICY "staff_read_all_chat_messages" ON owner_chat_messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM auto_entrepreneur WHERE ae_user_id = auth.uid() AND actif = true)
  );

DROP POLICY IF EXISTS "staff_insert_chat_messages" ON owner_chat_messages;
CREATE POLICY "staff_insert_chat_messages" ON owner_chat_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (SELECT 1 FROM auto_entrepreneur WHERE ae_user_id = auth.uid() AND actif = true)
  );

DROP POLICY IF EXISTS "staff_update_chat_messages" ON owner_chat_messages;
CREATE POLICY "staff_update_chat_messages" ON owner_chat_messages
  FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM auto_entrepreneur WHERE ae_user_id = auth.uid() AND actif = true)
  );
