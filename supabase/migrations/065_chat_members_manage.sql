-- 065_chat_members_manage.sql
-- Autoriser la gestion des membres depuis dcb-compta (utilisateurs authentifiés)

CREATE POLICY "chat_group_members_insert" ON chat_group_members
  FOR INSERT WITH CHECK (true);

CREATE POLICY "chat_group_members_delete" ON chat_group_members
  FOR DELETE USING (true);

CREATE POLICY "chat_room_members_insert" ON chat_room_members
  FOR INSERT WITH CHECK (true);

CREATE POLICY "chat_room_members_delete" ON chat_room_members
  FOR DELETE USING (true);
