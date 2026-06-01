-- Migration 160 — bucket Supabase Storage pour les documents portail owner
-- Crée le bucket 'owner-documents' (privé) et ses policies RLS.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'owner-documents',
  'owner-documents',
  false,
  10485760,  -- 10 MB
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Service role : accès total (upload depuis api/rapport-portail.js)
CREATE POLICY "owner_docs_service_all" ON storage.objects
  FOR ALL TO service_role
  USING (bucket_id = 'owner-documents')
  WITH CHECK (bucket_id = 'owner-documents');

-- Proprio authentifié : lecture de ses propres documents uniquement
-- (vérification via document-url.js qui génère des signed URLs → la policy storage n'est pas le seul garde-fou)
CREATE POLICY "owner_docs_proprio_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'owner-documents');
