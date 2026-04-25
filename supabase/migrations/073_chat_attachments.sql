ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS attachment_url text;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('chat-images', 'chat-images', true, 10485760, ARRAY['image/jpeg','image/png','image/gif','image/webp','image/heic','image/heif'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "chat images public read" ON storage.objects;
CREATE POLICY "chat images public read" ON storage.objects
  FOR SELECT USING (bucket_id = 'chat-images');

DROP POLICY IF EXISTS "chat images insert" ON storage.objects;
CREATE POLICY "chat images insert" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'chat-images');

DROP POLICY IF EXISTS "chat images delete own" ON storage.objects;
CREATE POLICY "chat images delete own" ON storage.objects
  FOR DELETE USING (bucket_id = 'chat-images');
