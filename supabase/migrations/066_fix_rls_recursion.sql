-- 066_fix_rls_recursion.sql
-- La policy chat_room_members_select faisait une sous-requête sur la même table
-- → infinite recursion. On simplifie : chaque user voit ses propres lignes.

DROP POLICY IF EXISTS "chat_room_members_select" ON chat_room_members;
CREATE POLICY "chat_room_members_select" ON chat_room_members
  FOR SELECT USING (user_id = auth.uid());

-- Idem pour chat_group_members qui avait le même pattern
DROP POLICY IF EXISTS "chat_group_members_select" ON chat_group_members;
CREATE POLICY "chat_group_members_select" ON chat_group_members
  FOR SELECT USING (user_id = auth.uid());
