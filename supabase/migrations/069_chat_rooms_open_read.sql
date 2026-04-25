-- 069_chat_rooms_open_read.sql
-- chat_rooms_select filtrait sur chat_group_members (auth.uid() requis).
-- Les APIs PowerHouse utilisent la clé service (bypass RLS), mais par
-- sécurité on ouvre la lecture à tout utilisateur authentifié,
-- et on autorise également la lecture sans auth (anon) pour les APIs internes.

DROP POLICY IF EXISTS "chat_rooms_select" ON chat_rooms;
CREATE POLICY "chat_rooms_select" ON chat_rooms
  FOR SELECT USING (true);
