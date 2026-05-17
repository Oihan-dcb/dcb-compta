-- Migration 145 : Fix RLS pour is_super (oihan@ peut envoyer comme staff)
-- Problème : les policies staff vérifient NOT EXISTS (proprietaire WHERE auth_user_id = auth.uid())
-- mais oihan@ EST dans proprietaire avec is_super=true → les checks staff échouent pour lui.
-- Fix : is_super=true est considéré comme staff même s'il est dans la table proprietaire.

-- ── owner_chat_rooms ─────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "staff_read_all_chat_rooms" ON owner_chat_rooms;
CREATE POLICY "staff_read_all_chat_rooms" ON owner_chat_rooms
  FOR SELECT TO authenticated
  USING (
    NOT EXISTS (SELECT 1 FROM proprietaire WHERE auth_user_id = auth.uid() AND is_super = false)
  );

DROP POLICY IF EXISTS "staff_insert_chat_rooms" ON owner_chat_rooms;
CREATE POLICY "staff_insert_chat_rooms" ON owner_chat_rooms
  FOR INSERT TO authenticated
  WITH CHECK (
    NOT EXISTS (SELECT 1 FROM proprietaire WHERE auth_user_id = auth.uid() AND is_super = false)
  );

-- ── owner_chat_messages ──────────────────────────────────────────────────────

DROP POLICY IF EXISTS "staff_read_all_chat_messages" ON owner_chat_messages;
CREATE POLICY "staff_read_all_chat_messages" ON owner_chat_messages
  FOR SELECT TO authenticated
  USING (
    NOT EXISTS (SELECT 1 FROM proprietaire WHERE auth_user_id = auth.uid() AND is_super = false)
  );

DROP POLICY IF EXISTS "staff_insert_chat_messages" ON owner_chat_messages;
CREATE POLICY "staff_insert_chat_messages" ON owner_chat_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND NOT EXISTS (SELECT 1 FROM proprietaire WHERE auth_user_id = auth.uid() AND is_super = false)
  );

DROP POLICY IF EXISTS "staff_update_chat_messages" ON owner_chat_messages;
CREATE POLICY "staff_update_chat_messages" ON owner_chat_messages
  FOR UPDATE TO authenticated
  USING (
    NOT EXISTS (SELECT 1 FROM proprietaire WHERE auth_user_id = auth.uid() AND is_super = false)
  );
