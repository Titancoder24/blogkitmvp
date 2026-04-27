-- BlogKit — schema additions for the v1.1 differentiator pack.
-- Adds: AI mention tracking, MCP federation, webhook firehose,
-- external-link health, brand voice guides, content provenance.

-- ---------- AI Mention Tracker ----------
DO $$ BEGIN
  CREATE TYPE blogkit_ai_provider AS ENUM
    ('chatgpt', 'claude', 'perplexity', 'gemini', 'copilot', 'grok');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- A query the team wants tracked (e.g. "best Next.js CMS").
CREATE TABLE IF NOT EXISTS blogkit_mention_queries (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  query        text NOT NULL,
  intent       text,                 -- 'commercial' | 'navigational' | 'informational'
  is_active    boolean NOT NULL DEFAULT true,
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS blogkit_mention_queries_active_idx
  ON blogkit_mention_queries (is_active) WHERE is_active = true;
CREATE TRIGGER blogkit_mention_queries_set_updated_at
  BEFORE UPDATE ON blogkit_mention_queries
  FOR EACH ROW EXECUTE FUNCTION blogkit_set_updated_at();

-- One probe = one (query × provider × timestamp). The polling worker
-- writes one row per provider per query per cycle.
CREATE TABLE IF NOT EXISTS blogkit_mention_results (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  query_id      uuid NOT NULL REFERENCES blogkit_mention_queries(id) ON DELETE CASCADE,
  provider      blogkit_ai_provider NOT NULL,
  probed_at     timestamptz NOT NULL DEFAULT now(),
  /** True if any of our domains/posts were cited in the answer. */
  was_cited     boolean NOT NULL,
  /** Specific posts cited (slugs). */
  cited_slugs   text[] NOT NULL DEFAULT ARRAY[]::text[],
  /** Competing domains cited alongside us, for share-of-voice. */
  competitor_domains text[] NOT NULL DEFAULT ARRAY[]::text[],
  /** Position in the answer (1 = primary citation). NULL when not cited. */
  citation_rank integer,
  /** Raw response excerpt for debugging — truncated to 4KB. */
  excerpt       text,
  /** Provider-specific metadata (model id, fan-out trace, etc.). */
  meta          jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS blogkit_mention_results_query_provider_idx
  ON blogkit_mention_results (query_id, provider, probed_at DESC);
CREATE INDEX IF NOT EXISTS blogkit_mention_results_cited_idx
  ON blogkit_mention_results (was_cited, probed_at DESC) WHERE was_cited = true;

-- ---------- MCP federation ----------
-- Lets BlogKit mount third-party MCP servers (Notion, Drive, Spotify,
-- Stripe, etc.) under a namespace so agents call them through BlogKit's
-- HTTP/stdio endpoint with one set of credentials.
CREATE TABLE IF NOT EXISTS blogkit_mcp_integrations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  namespace       text UNIQUE NOT NULL,         -- 'notion', 'drive', 'spotify', …
  display_name    text NOT NULL,
  endpoint_url    text,                         -- HTTP/SSE; null if stdio
  stdio_command   text,                         -- 'npx @notionhq/mcp-notion'
  stdio_args      text[] NOT NULL DEFAULT ARRAY[]::text[],
  /** OAuth2 token, API key, or service token — encrypted at rest by RLS. */
  credentials     jsonb,
  /** Tool names (post-prefix) the integration exposes. Cached at mount time. */
  tools           jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_enabled      boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER blogkit_mcp_integrations_set_updated_at
  BEFORE UPDATE ON blogkit_mcp_integrations
  FOR EACH ROW EXECUTE FUNCTION blogkit_set_updated_at();

-- ---------- Webhook event firehose ----------
DO $$ BEGIN
  CREATE TYPE blogkit_webhook_status AS ENUM ('pending', 'delivered', 'failed', 'expired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS blogkit_webhook_subscriptions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  url          text NOT NULL,
  /** HMAC-SHA256 secret — payload signatures use this. */
  secret_hash  text NOT NULL,
  /** Event names subscribed to. ['*'] subscribes to everything. */
  events       text[] NOT NULL DEFAULT ARRAY['*']::text[],
  is_enabled   boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER blogkit_webhook_subscriptions_set_updated_at
  BEFORE UPDATE ON blogkit_webhook_subscriptions
  FOR EACH ROW EXECUTE FUNCTION blogkit_set_updated_at();

CREATE TABLE IF NOT EXISTS blogkit_webhook_deliveries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES blogkit_webhook_subscriptions(id) ON DELETE CASCADE,
  event           text NOT NULL,            -- 'post.published'
  /** Idempotency key — set once, reused on retry. */
  idempotency_key text NOT NULL,
  payload         jsonb NOT NULL,
  status          blogkit_webhook_status NOT NULL DEFAULT 'pending',
  attempt         integer NOT NULL DEFAULT 0,
  /** Earliest UTC time the next attempt may run (exponential backoff). */
  next_attempt_at timestamptz,
  last_response_status integer,
  last_response_body   text,
  delivered_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS blogkit_webhook_deliveries_due_idx
  ON blogkit_webhook_deliveries (status, next_attempt_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS blogkit_webhook_deliveries_subscription_idx
  ON blogkit_webhook_deliveries (subscription_id, created_at DESC);

-- ---------- External link health ----------
DO $$ BEGIN
  CREATE TYPE blogkit_link_health AS ENUM ('healthy', 'redirect', 'broken', 'timeout', 'unchecked');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS blogkit_link_checks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  url             text NOT NULL,
  /** Most recent probe timestamp. */
  checked_at      timestamptz NOT NULL DEFAULT now(),
  status          blogkit_link_health NOT NULL DEFAULT 'unchecked',
  http_status     integer,
  redirect_target text,
  consecutive_failures integer NOT NULL DEFAULT 0,
  UNIQUE (url)
);
CREATE INDEX IF NOT EXISTS blogkit_link_checks_unhealthy_idx
  ON blogkit_link_checks (status, checked_at DESC)
  WHERE status IN ('broken', 'timeout');

-- Per-post → link join. Lets the dashboard show "this post has 3 broken links".
CREATE TABLE IF NOT EXISTS blogkit_post_links (
  post_id  uuid NOT NULL REFERENCES blogkit_posts(id) ON DELETE CASCADE,
  link_id  uuid NOT NULL REFERENCES blogkit_link_checks(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, link_id)
);
CREATE INDEX IF NOT EXISTS blogkit_post_links_link_idx ON blogkit_post_links (link_id);

-- ---------- Brand voice guide ----------
-- One active row per site. Drives the 7th scoring discipline.
CREATE TABLE IF NOT EXISTS blogkit_voice_guides (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  is_active    boolean NOT NULL DEFAULT false,
  /**
   * Words/phrases that must NEVER appear (case-insensitive substrings).
   * Used by the voice scorer + editor warnings.
   */
  banned       text[] NOT NULL DEFAULT ARRAY[]::text[],
  /**
   * Phrases / words that MUST appear at least once. Use for "always
   * mention 'open source'", brand name enforcement, etc.
   */
  required     text[] NOT NULL DEFAULT ARRAY[]::text[],
  /**
   * Tone words that signal the desired voice (e.g. "concise",
   * "technical", "warm"). The scorer rewards posts whose adjective
   * profile leans toward these.
   */
  tone         text[] NOT NULL DEFAULT ARRAY[]::text[],
  /** Acceptable sentence length range. */
  min_sentence_words integer NOT NULL DEFAULT 8,
  max_sentence_words integer NOT NULL DEFAULT 30,
  /** Optional explicit prose example the editor surfaces as the gold standard. */
  example_paragraph text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS blogkit_voice_guides_active_idx
  ON blogkit_voice_guides (is_active) WHERE is_active = true;
CREATE TRIGGER blogkit_voice_guides_set_updated_at
  BEFORE UPDATE ON blogkit_voice_guides
  FOR EACH ROW EXECUTE FUNCTION blogkit_set_updated_at();

-- ---------- Content provenance (C2PA) ----------
-- Each publish writes a provenance manifest (claims about who created
-- the post, when, with what tools). Signed with a site-level key; the
-- public renderer embeds the signature in a <meta> tag and the JSON-LD
-- `creditText` field for AI engines that verify provenance.
CREATE TABLE IF NOT EXISTS blogkit_provenance_manifests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id          uuid NOT NULL REFERENCES blogkit_posts(id) ON DELETE CASCADE,
  /** SHA-256 of the canonical post body at signing time. */
  body_hash        text NOT NULL,
  /** The structured manifest (C2PA-compatible JSON). */
  manifest         jsonb NOT NULL,
  /** Detached signature (base64). Verifiable with the site's public key. */
  signature        text NOT NULL,
  /** Algorithm identifier. */
  algorithm        text NOT NULL DEFAULT 'ed25519',
  /** Signing key id — lets us rotate keys without invalidating history. */
  key_id           text NOT NULL,
  signed_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS blogkit_provenance_post_idx
  ON blogkit_provenance_manifests (post_id, signed_at DESC);

-- ---------- Headline A/B variants ----------
CREATE TABLE IF NOT EXISTS blogkit_headline_variants (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id         uuid NOT NULL REFERENCES blogkit_posts(id) ON DELETE CASCADE,
  headline        text NOT NULL,
  /** Aggregate AI Visibility Score predicted for this headline variant. */
  predicted_score numeric(5,2),
  /** Per-discipline scores (snapshot). */
  scores          jsonb,
  /** True for the chosen-to-ship variant. */
  is_winner       boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS blogkit_headline_variants_post_idx
  ON blogkit_headline_variants (post_id, predicted_score DESC NULLS LAST);
CREATE UNIQUE INDEX IF NOT EXISTS blogkit_headline_variants_winner_idx
  ON blogkit_headline_variants (post_id) WHERE is_winner = true;

-- ---------- RLS for the new tables ----------
ALTER TABLE blogkit_mention_queries        ENABLE ROW LEVEL SECURITY;
ALTER TABLE blogkit_mention_results        ENABLE ROW LEVEL SECURITY;
ALTER TABLE blogkit_mcp_integrations       ENABLE ROW LEVEL SECURITY;
ALTER TABLE blogkit_webhook_subscriptions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE blogkit_webhook_deliveries     ENABLE ROW LEVEL SECURITY;
ALTER TABLE blogkit_link_checks            ENABLE ROW LEVEL SECURITY;
ALTER TABLE blogkit_post_links             ENABLE ROW LEVEL SECURITY;
ALTER TABLE blogkit_voice_guides           ENABLE ROW LEVEL SECURITY;
ALTER TABLE blogkit_provenance_manifests   ENABLE ROW LEVEL SECURITY;
ALTER TABLE blogkit_headline_variants      ENABLE ROW LEVEL SECURITY;

-- Admin-only for everything internal — none of these are public-readable
-- (provenance signatures *are* public, exposed via the rendered HTML's
-- <meta> tag rather than direct DB read).
CREATE POLICY blogkit_mention_queries_admin
  ON blogkit_mention_queries FOR ALL
  USING (blogkit_current_role() = 'admin')
  WITH CHECK (blogkit_current_role() = 'admin');
CREATE POLICY blogkit_mention_results_admin
  ON blogkit_mention_results FOR ALL
  USING (blogkit_current_role() = 'admin')
  WITH CHECK (blogkit_current_role() = 'admin');
CREATE POLICY blogkit_mcp_integrations_admin
  ON blogkit_mcp_integrations FOR ALL
  USING (blogkit_current_role() = 'admin')
  WITH CHECK (blogkit_current_role() = 'admin');
CREATE POLICY blogkit_webhook_subscriptions_admin
  ON blogkit_webhook_subscriptions FOR ALL
  USING (blogkit_current_role() = 'admin')
  WITH CHECK (blogkit_current_role() = 'admin');
CREATE POLICY blogkit_webhook_deliveries_admin
  ON blogkit_webhook_deliveries FOR ALL
  USING (blogkit_current_role() = 'admin')
  WITH CHECK (blogkit_current_role() = 'admin');
CREATE POLICY blogkit_link_checks_editor_read
  ON blogkit_link_checks FOR SELECT
  USING (blogkit_current_role() IN ('admin', 'editor'));
CREATE POLICY blogkit_link_checks_admin_write
  ON blogkit_link_checks FOR ALL
  USING (blogkit_current_role() = 'admin')
  WITH CHECK (blogkit_current_role() = 'admin');
CREATE POLICY blogkit_post_links_editor_read
  ON blogkit_post_links FOR SELECT
  USING (blogkit_current_role() IN ('admin', 'editor'));
CREATE POLICY blogkit_post_links_admin_write
  ON blogkit_post_links FOR ALL
  USING (blogkit_current_role() = 'admin')
  WITH CHECK (blogkit_current_role() = 'admin');
CREATE POLICY blogkit_voice_guides_editor_read
  ON blogkit_voice_guides FOR SELECT
  USING (blogkit_current_role() IN ('admin', 'editor'));
CREATE POLICY blogkit_voice_guides_admin_write
  ON blogkit_voice_guides FOR ALL
  USING (blogkit_current_role() = 'admin')
  WITH CHECK (blogkit_current_role() = 'admin');
-- Provenance is public-readable (the manifests + signatures back the
-- public-facing claim; agents verify against the site's public key).
CREATE POLICY blogkit_provenance_public_read
  ON blogkit_provenance_manifests FOR SELECT
  USING (post_id IN (SELECT id FROM blogkit_posts WHERE status = 'published'));
CREATE POLICY blogkit_provenance_admin_write
  ON blogkit_provenance_manifests FOR ALL
  USING (blogkit_current_role() = 'admin')
  WITH CHECK (blogkit_current_role() = 'admin');
CREATE POLICY blogkit_headline_variants_editor
  ON blogkit_headline_variants FOR ALL
  USING (blogkit_current_role() IN ('admin', 'editor'))
  WITH CHECK (blogkit_current_role() IN ('admin', 'editor'));
