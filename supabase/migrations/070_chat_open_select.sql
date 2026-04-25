-- 070_chat_open_select.sql
-- Outil interne : on ouvre SELECT sur chat_room_members et chat_group_members
-- (les APIs PowerHouse utilisent l'anon key sans JWT utilisateur)

DROP POLICY IF EXISTS "chat_room_members_select" ON chat_room_members;
CREATE POLICY "chat_room_members_select" ON chat_room_members
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "chat_group_members_select" ON chat_group_members;
CREATE POLICY "chat_group_members_select" ON chat_group_members
  FOR SELECT USING (true);
