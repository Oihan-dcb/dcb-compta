-- 064_chat_groups_insert.sql
-- Autoriser les utilisateurs authentifiés à créer des groupes messagerie

CREATE POLICY "chat_groups_insert" ON chat_groups
  FOR INSERT WITH CHECK (true);
