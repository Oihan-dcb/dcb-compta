-- 063_chat_groups_open_read.sql
-- La policy chat_groups_select exigeait d'être dans chat_group_members.
-- Dans dcb-compta, les admins (Laura, Clémence, Oïhan) ont un auth.uid()
-- différent de leur ae_user_id → le dropdown restait vide.
-- On ouvre la lecture à tout utilisateur authentifié.

DROP POLICY IF EXISTS "chat_groups_select" ON chat_groups;
DROP POLICY IF EXISTS "chat_groups_select_authenticated" ON chat_groups;

CREATE POLICY "chat_groups_select" ON chat_groups
  FOR SELECT USING (true);
