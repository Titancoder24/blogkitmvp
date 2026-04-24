-- BlogKit — initial schema
-- Implements PRD §7.1 (tables) and §7.3 (indexes). RLS lives in 0002.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------- enums ----------
DO $$ BEGIN
  CREATE TYPE blogkit_post_status AS ENUM
    ('draft', 'in_review', 'scheduled', 'published', 'archived');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE blogkit_schema_type AS ENUM
    ('BlogPosting', 'Article', 'NewsArticle', 'TechArticle');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE blogkit_author_role AS ENUM ('admin', 'editor', 'viewer');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE blogkit_mcp_token_scope AS ENUM ('read', 'write', 'admin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------- shared updated_at trigger ----------
CREATE OR REPLACE FUNCTION blogkit_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------- authors ----------
-- Linked to Supabase auth.users via supabase_user_id; role drives RLS.
CREATE TABLE IF NOT EXISTS blogkit_authors (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supabase_user_id  uuid UNIQUE,
  name              text NOT NULL,
  bio               text,
  avatar_url        text,
  twitter           text,
  linkedin          text,
  github            text,
  website           text,
  same_as           jsonb NOT NULL DEFAULT '[]'::jsonb,
  role              blogkit_author_role NOT NULL DEFAULT 'editor',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER blogkit_authors_set_updated_at
  BEFORE UPDATE ON blogkit_authors
  FOR EACH ROW EXECUTE FUNCTION blogkit_set_updated_at();

-- ---------- tags ----------
CREATE TABLE IF NOT EXISTS blogkit_tags (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  slug        text UNIQUE NOT NULL,
  description text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------- categories ----------
CREATE TABLE IF NOT EXISTS blogkit_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  slug        text UNIQUE NOT NULL,
  description text,
  parent_id   uuid REFERENCES blogkit_categories(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS blogkit_categories_parent_idx
  ON blogkit_categories (parent_id);

-- ---------- templates ----------
-- Built-in templates (article, listicle, comparison, …) are seeded by
-- 0003_seed_templates.sql. Custom templates are inserted by the admin's
-- Custom Template Builder (PRD §5D.6) and by the v1.5 agent tool surface
-- (PRD §19.2).
CREATE TABLE IF NOT EXISTS blogkit_templates (
  id              text PRIMARY KEY,
  name            text NOT NULL,
  description     text,
  is_built_in     boolean NOT NULL DEFAULT false,
  fields          jsonb NOT NULL DEFAULT '[]'::jsonb,
  blocks          jsonb NOT NULL DEFAULT '[]'::jsonb,
  schema_mapping  jsonb NOT NULL DEFAULT '{}'::jsonb,
  scoring_rules   jsonb NOT NULL DEFAULT '{}'::jsonb,
  default_layout  jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER blogkit_templates_set_updated_at
  BEFORE UPDATE ON blogkit_templates
  FOR EACH ROW EXECUTE FUNCTION blogkit_set_updated_at();

-- ---------- posts ----------
CREATE TABLE IF NOT EXISTS blogkit_posts (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                     text UNIQUE NOT NULL,
  title                    text NOT NULL,
  body_mdx                 text NOT NULL DEFAULT '',
  body_html                text,
  excerpt                  text,
  cover_image_url          text,
  status                   blogkit_post_status NOT NULL DEFAULT 'draft',
  publish_at               timestamptz,
  published_at             timestamptz,
  last_refreshed_at        timestamptz,
  author_id                uuid REFERENCES blogkit_authors(id) ON DELETE SET NULL,
  schema_type              blogkit_schema_type NOT NULL DEFAULT 'BlogPosting',
  template_id              text NOT NULL DEFAULT 'article'
                             REFERENCES blogkit_templates(id) ON DELETE RESTRICT,
  template_overflow        jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_url            text,
  custom_meta_title        text,
  custom_meta_description  text,
  custom_og_image          text,
  noindex                  boolean NOT NULL DEFAULT false,
  reading_time_minutes     integer,
  word_count               integer,
  citation_count           integer NOT NULL DEFAULT 0,
  faq_json                 jsonb,
  tldr                     text,
  ai_visibility_score      numeric(5,2),
  is_cornerstone           boolean NOT NULL DEFAULT false,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER blogkit_posts_set_updated_at
  BEFORE UPDATE ON blogkit_posts
  FOR EACH ROW EXECUTE FUNCTION blogkit_set_updated_at();

CREATE INDEX IF NOT EXISTS blogkit_posts_status_published_at_idx
  ON blogkit_posts (status, published_at DESC);
CREATE INDEX IF NOT EXISTS blogkit_posts_author_idx
  ON blogkit_posts (author_id);
CREATE INDEX IF NOT EXISTS blogkit_posts_template_idx
  ON blogkit_posts (template_id);
CREATE INDEX IF NOT EXISTS blogkit_posts_search_idx
  ON blogkit_posts USING GIN (
    to_tsvector('english',
      coalesce(title, '') || ' ' ||
      coalesce(excerpt, '') || ' ' ||
      coalesce(body_mdx, '')
    )
  );

-- ---------- pages (static pages: About, Contact, etc.) ----------
CREATE TABLE IF NOT EXISTS blogkit_pages (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                     text UNIQUE NOT NULL,
  title                    text NOT NULL,
  body_mdx                 text NOT NULL DEFAULT '',
  body_html                text,
  excerpt                  text,
  cover_image_url          text,
  status                   blogkit_post_status NOT NULL DEFAULT 'draft',
  publish_at               timestamptz,
  published_at             timestamptz,
  last_refreshed_at        timestamptz,
  author_id                uuid REFERENCES blogkit_authors(id) ON DELETE SET NULL,
  schema_type              blogkit_schema_type NOT NULL DEFAULT 'Article',
  template_id              text NOT NULL DEFAULT 'article'
                             REFERENCES blogkit_templates(id) ON DELETE RESTRICT,
  template_overflow        jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_url            text,
  custom_meta_title        text,
  custom_meta_description  text,
  custom_og_image          text,
  noindex                  boolean NOT NULL DEFAULT false,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER blogkit_pages_set_updated_at
  BEFORE UPDATE ON blogkit_pages
  FOR EACH ROW EXECUTE FUNCTION blogkit_set_updated_at();

-- ---------- post_tags / post_categories joins ----------
CREATE TABLE IF NOT EXISTS blogkit_post_tags (
  post_id uuid NOT NULL REFERENCES blogkit_posts(id) ON DELETE CASCADE,
  tag_id  uuid NOT NULL REFERENCES blogkit_tags(id)  ON DELETE CASCADE,
  PRIMARY KEY (post_id, tag_id)
);
CREATE INDEX IF NOT EXISTS blogkit_post_tags_tag_idx ON blogkit_post_tags (tag_id);

CREATE TABLE IF NOT EXISTS blogkit_post_categories (
  post_id     uuid NOT NULL REFERENCES blogkit_posts(id)      ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES blogkit_categories(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, category_id)
);
CREATE INDEX IF NOT EXISTS blogkit_post_categories_category_idx
  ON blogkit_post_categories (category_id);

-- ---------- media ----------
-- Originals + webp/avif variants generated on upload (PRD §6.8).
CREATE TABLE IF NOT EXISTS blogkit_media (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  original_url  text NOT NULL,
  webp_url      text,
  avif_url      text,
  sizes         jsonb NOT NULL DEFAULT '{}'::jsonb, -- {thumb, medium, full}
  alt_text      text,
  caption       text,
  post_id       uuid REFERENCES blogkit_posts(id) ON DELETE SET NULL,
  uploaded_by   uuid REFERENCES blogkit_authors(id) ON DELETE SET NULL,
  uploaded_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS blogkit_media_post_idx ON blogkit_media (post_id);

-- ---------- citations ----------
-- First-class block (PRD §5.2): captures URL, title, author, date, excerpt.
-- Feeds JSON-LD `citation` array; renders inline with rel="nofollow" (§6.3).
CREATE TABLE IF NOT EXISTS blogkit_citations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id             uuid NOT NULL REFERENCES blogkit_posts(id) ON DELETE CASCADE,
  source_url          text NOT NULL,
  source_title        text,
  source_author       text,
  source_published_at timestamptz,
  excerpt             text,
  position_in_post    integer,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS blogkit_citations_post_idx
  ON blogkit_citations (post_id, position_in_post);

-- ---------- revisions ----------
-- Every save creates a row (PRD §5.3, §5A.5). Used for version history slider
-- and `dateModified` JSON-LD signal (§18.3).
CREATE TABLE IF NOT EXISTS blogkit_revisions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id               uuid NOT NULL REFERENCES blogkit_posts(id) ON DELETE CASCADE,
  body_snapshot         text NOT NULL,
  title_snapshot        text,
  template_id_snapshot  text,
  ai_visibility_score   numeric(5,2),
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid REFERENCES blogkit_authors(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS blogkit_revisions_post_idx
  ON blogkit_revisions (post_id, created_at DESC);

-- ---------- seo_overrides ----------
CREATE TABLE IF NOT EXISTS blogkit_seo_overrides (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id               uuid UNIQUE NOT NULL REFERENCES blogkit_posts(id) ON DELETE CASCADE,
  robots_directive      text,
  custom_jsonld_block   jsonb
);

-- ---------- mcp_tokens ----------
-- Service tokens for the MCP server (PRD §9.4). Default scope is read; write
-- and admin scopes are explicit opt-in. token_hash stores a SHA-256 of the
-- raw token; the raw value is shown once at creation and never persisted.
CREATE TABLE IF NOT EXISTS blogkit_mcp_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  token_hash   text NOT NULL UNIQUE,
  scope        blogkit_mcp_token_scope NOT NULL DEFAULT 'read',
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at   timestamptz,
  created_by   uuid REFERENCES blogkit_authors(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS blogkit_mcp_tokens_active_idx
  ON blogkit_mcp_tokens (revoked_at) WHERE revoked_at IS NULL;

-- ---------- settings ----------
-- Single-row-per-key store for site/organization/theme/SEO config (PRD §5.5).
CREATE TABLE IF NOT EXISTS blogkit_settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- audit_log ----------
-- Every MCP-driven publish action logs here (PRD §9.4); also powers the
-- v1.5 tool-creation audit trail (§19.5).
CREATE TABLE IF NOT EXISTS blogkit_audit_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_type  text NOT NULL,    -- 'user' | 'mcp_token' | 'system'
  actor_id    text,
  action      text NOT NULL,    -- 'post.publish', 'token.create', …
  target_type text,
  target_id   text,
  payload     jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS blogkit_audit_log_actor_idx
  ON blogkit_audit_log (actor_type, actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS blogkit_audit_log_target_idx
  ON blogkit_audit_log (target_type, target_id, created_at DESC);
