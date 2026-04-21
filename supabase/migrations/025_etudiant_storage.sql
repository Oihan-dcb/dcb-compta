-- Migration 025 : Bucket Supabase Storage pour les documents étudiants
--
-- Bucket privé : quittances PDF + documents dossier (contrat, EDS…)
-- Accès : service_role uniquement (les URLs signées sont générées à la demande)

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'etudiant-documents',
  'etudiant-documents',
  false,
  10485760,  -- 10 MB max
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- RLS : service_role bypass — accès via URLs signées générées par les edge functions
-- Les utilisateurs authenticated peuvent lire via signed URL (génération côté edge function)
CREATE POLICY "service_role_etudiant_documents" ON storage.objects
  FOR ALL TO service_role USING (bucket_id = 'etudiant-documents');

CREATE POLICY "authenticated_read_etudiant_documents" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'etudiant-documents');
