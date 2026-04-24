-- BlogKit — Supabase Storage buckets and access policies (PRD §4.1, §5.4).
--
-- Two buckets:
--   blogkit-media    — public-read, holds finalized media referenced by posts.
--   blogkit-uploads  — private staging area for in-progress uploads. Files
--                      are promoted into blogkit-media when a post that
--                      references them is published.
--
-- Storage policies live in storage.objects, which Supabase exposes with RLS
-- pre-enabled.

INSERT INTO storage.buckets (id, name, public)
VALUES
  ('blogkit-media',   'blogkit-media',   true),
  ('blogkit-uploads', 'blogkit-uploads', false)
ON CONFLICT (id) DO NOTHING;

-- ---------- blogkit-media ----------
DROP POLICY IF EXISTS "blogkit_media_public_read" ON storage.objects;
CREATE POLICY "blogkit_media_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'blogkit-media');

DROP POLICY IF EXISTS "blogkit_media_editor_write" ON storage.objects;
CREATE POLICY "blogkit_media_editor_write"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'blogkit-media'
    AND blogkit_current_role() IN ('admin', 'editor')
  );

DROP POLICY IF EXISTS "blogkit_media_editor_update" ON storage.objects;
CREATE POLICY "blogkit_media_editor_update"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'blogkit-media'
    AND blogkit_current_role() IN ('admin', 'editor')
  );

DROP POLICY IF EXISTS "blogkit_media_admin_delete" ON storage.objects;
CREATE POLICY "blogkit_media_admin_delete"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'blogkit-media'
    AND blogkit_current_role() = 'admin'
  );

-- ---------- blogkit-uploads ----------
-- Owner-scoped: each editor sees only their own staging files.
DROP POLICY IF EXISTS "blogkit_uploads_owner_read" ON storage.objects;
CREATE POLICY "blogkit_uploads_owner_read"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'blogkit-uploads'
    AND owner = auth.uid()
  );

DROP POLICY IF EXISTS "blogkit_uploads_owner_write" ON storage.objects;
CREATE POLICY "blogkit_uploads_owner_write"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'blogkit-uploads'
    AND blogkit_current_role() IN ('admin', 'editor')
    AND owner = auth.uid()
  );

DROP POLICY IF EXISTS "blogkit_uploads_owner_delete" ON storage.objects;
CREATE POLICY "blogkit_uploads_owner_delete"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'blogkit-uploads'
    AND (owner = auth.uid() OR blogkit_current_role() = 'admin')
  );
