-- 071_chat_messages_open.sql
-- PowerHouse n'a pas de session Supabase Auth (anon key uniquement).
-- Les policies SELECT et INSERT sur chat_messages requièrent auth.uid()
-- et bloquent donc toute interaction depuis PowerHouse.
-- L'API messagerie-messages.js vérifie elle-même le membership avant
-- de lire ou d'écrire → on peut ouvrir les policies côté DB.

DROP POLICY IF EXISTS "chat_messages_select" ON chat_messages;
CREATE POLICY "chat_messages_select" ON chat_messages
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "chat_messages_insert" ON chat_messages;
CREATE POLICY "chat_messages_insert" ON chat_messages
  FOR INSERT WITH CHECK (true);
