-- BlogKit — Row-Level Security policies (PRD §7.2)
--
-- Roles (resolved via blogkit_authors.role for the authenticated user):
--   admin  — full access
--   editor — create/edit own posts; cannot delete
--   viewer — read-only (drafts visible only to authors and admins)
--
-- Anonymous (unauthenticated) callers can read published posts/pages,
-- public taxonomy, public author profiles, and citations on published posts.

-- ---------- helper: who-am-I ----------
-- STABLE so policies can call it freely without re-evaluating per row.
CREATE OR REPLACE FUNCTION blogkit_current_role()
RETURNS blogkit_author_role
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role
  FROM blogkit_authors
  WHERE supabase_user_id = auth.uid()
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION blogkit_current_author_id()
RETURNS uuid
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id
  FROM blogkit_authors
  WHERE supabase_user_id = auth.uid()
  LIMIT 1;
$$;

-- ---------- enable RLS on every table ----------
ALTER TABLE blogkit_posts            ENABLE ROW LEVEL SECURITY;
ALTER TABLE blogkit_pages            ENABLE ROW LEVEL SECURITY;
ALTER TABLE blogkit_tags             ENABLE ROW LEVEL SECURITY;
ALTER TABLE blogkit_categories       ENABLE ROW LEVEL SECURITY;
ALTER TABLE blogkit_authors          ENABLE ROW LEVEL SECURITY;
ALTER TABLE blogkit_post_tags        ENABLE ROW LEVEL SECURITY;
ALTER TABLE blogkit_post_categories  ENABLE ROW LEVEL SECURITY;
ALTER TABLE blogkit_media            ENABLE ROW LEVEL SECURITY;
ALTER TABLE blogkit_citations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE blogkit_revisions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE blogkit_seo_overrides    ENABLE ROW LEVEL SECURITY;
ALTER TABLE blogkit_mcp_tokens       ENABLE ROW LEVEL SECURITY;
ALTER TABLE blogkit_templates        ENABLE ROW LEVEL SECURITY;
ALTER TABLE blogkit_settings         ENABLE ROW LEVEL SECURITY;
ALTER TABLE blogkit_audit_log        ENABLE ROW LEVEL SECURITY;

-- ---------- posts ----------
CREATE POLICY blogkit_posts_public_read
  ON blogkit_posts FOR SELECT
  USING (status = 'published');

CREATE POLICY blogkit_posts_author_read_own
  ON blogkit_posts FOR SELECT
  USING (author_id = blogkit_current_author_id());

CREATE POLICY blogkit_posts_admin_read_all
  ON blogkit_posts FOR SELECT
  USING (blogkit_current_role() = 'admin');

CREATE POLICY blogkit_posts_editor_insert
  ON blogkit_posts FOR INSERT
  WITH CHECK (
    blogkit_current_role() IN ('admin', 'editor')
    AND author_id = blogkit_current_author_id()
  );

CREATE POLICY blogkit_posts_editor_update_own
  ON blogkit_posts FOR UPDATE
  USING (
    blogkit_current_role() IN ('admin', 'editor')
    AND (author_id = blogkit_current_author_id() OR blogkit_current_role() = 'admin')
  )
  WITH CHECK (
    blogkit_current_role() IN ('admin', 'editor')
    AND (author_id = blogkit_current_author_id() OR blogkit_current_role() = 'admin')
  );

-- Editors cannot delete (PRD §5.1). Only admins.
CREATE POLICY blogkit_posts_admin_delete
  ON blogkit_posts FOR DELETE
  USING (blogkit_current_role() = 'admin');

-- ---------- pages ----------
CREATE POLICY blogkit_pages_public_read
  ON blogkit_pages FOR SELECT
  USING (status = 'published');

CREATE POLICY blogkit_pages_admin_all
  ON blogkit_pages FOR ALL
  USING (blogkit_current_role() = 'admin')
  WITH CHECK (blogkit_current_role() = 'admin');

-- ---------- tags / categories ----------
CREATE POLICY blogkit_tags_public_read
  ON blogkit_tags FOR SELECT USING (true);
CREATE POLICY blogkit_tags_editor_write
  ON blogkit_tags FOR ALL
  USING (blogkit_current_role() IN ('admin', 'editor'))
  WITH CHECK (blogkit_current_role() IN ('admin', 'editor'));

CREATE POLICY blogkit_categories_public_read
  ON blogkit_categories FOR SELECT USING (true);
CREATE POLICY blogkit_categories_editor_write
  ON blogkit_categories FOR ALL
  USING (blogkit_current_role() IN ('admin', 'editor'))
  WITH CHECK (blogkit_current_role() IN ('admin', 'editor'));

-- ---------- post_tags / post_categories ----------
-- Read mirrors the underlying post; write requires editor on the post.
CREATE POLICY blogkit_post_tags_public_read
  ON blogkit_post_tags FOR SELECT
  USING (post_id IN (SELECT id FROM blogkit_posts WHERE status = 'published'));
CREATE POLICY blogkit_post_tags_admin_read
  ON blogkit_post_tags FOR SELECT
  USING (blogkit_current_role() IN ('admin', 'editor'));
CREATE POLICY blogkit_post_tags_editor_write
  ON blogkit_post_tags FOR ALL
  USING (blogkit_current_role() IN ('admin', 'editor'))
  WITH CHECK (blogkit_current_role() IN ('admin', 'editor'));

CREATE POLICY blogkit_post_categories_public_read
  ON blogkit_post_categories FOR SELECT
  USING (post_id IN (SELECT id FROM blogkit_posts WHERE status = 'published'));
CREATE POLICY blogkit_post_categories_admin_read
  ON blogkit_post_categories FOR SELECT
  USING (blogkit_current_role() IN ('admin', 'editor'));
CREATE POLICY blogkit_post_categories_editor_write
  ON blogkit_post_categories FOR ALL
  USING (blogkit_current_role() IN ('admin', 'editor'))
  WITH CHECK (blogkit_current_role() IN ('admin', 'editor'));

-- ---------- authors ----------
-- Author profiles are public-readable so JSON-LD `Person` and author pages
-- work for anonymous visitors and AI crawlers.
CREATE POLICY blogkit_authors_public_read
  ON blogkit_authors FOR SELECT USING (true);
CREATE POLICY blogkit_authors_self_update
  ON blogkit_authors FOR UPDATE
  USING (supabase_user_id = auth.uid())
  WITH CHECK (supabase_user_id = auth.uid() AND role = blogkit_current_role());
CREATE POLICY blogkit_authors_admin_all
  ON blogkit_authors FOR ALL
  USING (blogkit_current_role() = 'admin')
  WITH CHECK (blogkit_current_role() = 'admin');

-- ---------- media ----------
CREATE POLICY blogkit_media_public_read
  ON blogkit_media FOR SELECT USING (true);
CREATE POLICY blogkit_media_editor_write
  ON blogkit_media FOR ALL
  USING (blogkit_current_role() IN ('admin', 'editor'))
  WITH CHECK (blogkit_current_role() IN ('admin', 'editor'));

-- ---------- citations ----------
CREATE POLICY blogkit_citations_public_read
  ON blogkit_citations FOR SELECT
  USING (post_id IN (SELECT id FROM blogkit_posts WHERE status = 'published'));
CREATE POLICY blogkit_citations_editor_read
  ON blogkit_citations FOR SELECT
  USING (blogkit_current_role() IN ('admin', 'editor'));
CREATE POLICY blogkit_citations_editor_write
  ON blogkit_citations FOR ALL
  USING (blogkit_current_role() IN ('admin', 'editor'))
  WITH CHECK (blogkit_current_role() IN ('admin', 'editor'));

-- ---------- revisions ----------
-- Internal-only — never exposed to anon.
CREATE POLICY blogkit_revisions_editor_read
  ON blogkit_revisions FOR SELECT
  USING (blogkit_current_role() IN ('admin', 'editor'));
CREATE POLICY blogkit_revisions_editor_insert
  ON blogkit_revisions FOR INSERT
  WITH CHECK (blogkit_current_role() IN ('admin', 'editor'));

-- ---------- seo_overrides ----------
CREATE POLICY blogkit_seo_overrides_public_read
  ON blogkit_seo_overrides FOR SELECT USING (true);
CREATE POLICY blogkit_seo_overrides_editor_write
  ON blogkit_seo_overrides FOR ALL
  USING (blogkit_current_role() IN ('admin', 'editor'))
  WITH CHECK (blogkit_current_role() IN ('admin', 'editor'));

-- ---------- mcp_tokens ----------
-- Admin-only. The raw token is never stored — only its SHA-256 hash.
CREATE POLICY blogkit_mcp_tokens_admin_only
  ON blogkit_mcp_tokens FOR ALL
  USING (blogkit_current_role() = 'admin')
  WITH CHECK (blogkit_current_role() = 'admin');

-- ---------- templates ----------
CREATE POLICY blogkit_templates_public_read
  ON blogkit_templates FOR SELECT USING (true);
CREATE POLICY blogkit_templates_admin_write
  ON blogkit_templates FOR ALL
  USING (blogkit_current_role() = 'admin')
  WITH CHECK (blogkit_current_role() = 'admin');

-- ---------- settings ----------
-- A subset of keys (e.g. `site.name`, `organization.sameAs`) are public-read
-- because the public renderer needs them. Implementation: mark public keys
-- with the `public.` prefix; everything else is admin-gated.
CREATE POLICY blogkit_settings_public_read
  ON blogkit_settings FOR SELECT
  USING (key LIKE 'public.%');
CREATE POLICY blogkit_settings_admin_read
  ON blogkit_settings FOR SELECT
  USING (blogkit_current_role() = 'admin');
CREATE POLICY blogkit_settings_admin_write
  ON blogkit_settings FOR ALL
  USING (blogkit_current_role() = 'admin')
  WITH CHECK (blogkit_current_role() = 'admin');

-- ---------- audit_log ----------
CREATE POLICY blogkit_audit_log_admin_read
  ON blogkit_audit_log FOR SELECT
  USING (blogkit_current_role() = 'admin');
-- INSERT is performed by the service role from server code (no policy =
-- denied to authenticated/anon, which is what we want).
