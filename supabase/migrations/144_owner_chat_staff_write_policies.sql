-- Migration 144 : Policies d'écriture staff sur owner_chat
-- La migration 142 avait sécurisé les SELECT (proprios voient seulement leurs rooms)
-- mais avait oublié les INSERT/UPDATE/DELETE pour le staff.
-- Staff = authenticated user qui N'EST PAS dans la table proprietaire.

-- ── owner_chat_rooms ─────────────────────────────────────────────────────────

-- Staff peut lire toutes les rooms (pour administrer)
CREATE POLICY "staff_read_all_chat_rooms" ON owner_chat_rooms
  FOR SELECT TO authenticated
  USING (
    NOT EXISTS (SELECT 1 FROM proprietaire WHERE auth_user_id = auth.uid())
  );

-- Staff peut créer des rooms
CREATE POLICY "staff_insert_chat_rooms" ON owner_chat_rooms
  FOR INSERT TO authenticated
  WITH CHECK (
    NOT EXISTS (SELECT 1 FROM proprietaire WHERE auth_user_id = auth.uid())
  );

-- ── owner_chat_messages ──────────────────────────────────────────────────────

-- Staff peut lire tous les messages
CREATE POLICY "staff_read_all_chat_messages" ON owner_chat_messages
  FOR SELECT TO authenticated
  USING (
    NOT EXISTS (SELECT 1 FROM proprietaire WHERE auth_user_id = auth.uid())
  );

-- Staff peut envoyer des messages
CREATE POLICY "staff_insert_chat_messages" ON owner_chat_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND NOT EXISTS (SELECT 1 FROM proprietaire WHERE auth_user_id = auth.uid())
  );

-- Staff peut soft-delete (deleted_at)
CREATE POLICY "staff_update_chat_messages" ON owner_chat_messages
  FOR UPDATE TO authenticated
  USING (
    NOT EXISTS (SELECT 1 FROM proprietaire WHERE auth_user_id = auth.uid())
  );

-- Proprio peut envoyer des messages dans ses propres rooms support
CREATE POLICY "proprio_insert_own_chat_messages" ON owner_chat_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND sender_type = 'proprio'
    AND room_id IN (
      SELECT id FROM owner_chat_rooms
      WHERE proprio_id IN (SELECT id FROM proprietaire WHERE auth_user_id = auth.uid())
    )
  );
