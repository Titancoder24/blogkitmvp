/**
 * Shared types for the BlogKit content model. These shapes are the contract
 * between every adapter (`@blogkit/supabase`, future `@blogkit/firebase`,
 * `@blogkit/mongo`, …), the editor, the public renderer, and the MCP server.
 *
 * Naming follows the SQL schema in `@blogkit/supabase/migrations/0001_initial_schema.sql`
 * but uses camelCase. Adapters are responsible for the snake_case ↔ camelCase
 * mapping.
 */

// ---------- enums ----------
export type PostStatus =
  | "draft"
  | "in_review"
  | "scheduled"
  | "published"
  | "archived";

export type SchemaType =
  | "BlogPosting"
  | "Article"
  | "NewsArticle"
  | "TechArticle";

export type AuthorRole = "admin" | "editor" | "viewer";

export type McpTokenScope = "read" | "write" | "admin";

/**
 * The 12 built-in template ids (PRD §5D.2). Custom templates use any
 * lowercase-kebab string id, so `string` is part of the union.
 */
export type BuiltInTemplateId =
  | "article"
  | "listicle"
  | "comparison"
  | "review"
  | "glossary"
  | "how-to"
  | "recipe"
  | "product"
  | "faq-hub"
  | "news"
  | "case-study"
  | "landing";

export type TemplateId = BuiltInTemplateId | (string & {});

// ---------- content ----------
export interface FAQItem {
  question: string;
  answer: string;
}

export interface Author {
  id: string;
  supabaseUserId?: string;
  name: string;
  bio?: string;
  avatarUrl?: string;
  twitter?: string;
  linkedin?: string;
  github?: string;
  website?: string;
  /** Schema.org `sameAs` URLs — Wikidata, Crunchbase, etc. */
  sameAs: string[];
  role: AuthorRole;
  createdAt: string;
  updatedAt: string;
}

export interface Tag {
  id: string;
  name: string;
  slug: string;
  description?: string;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  description?: string;
  parentId?: string;
}

export interface Citation {
  id: string;
  postId: string;
  sourceUrl: string;
  sourceTitle?: string;
  sourceAuthor?: string;
  sourcePublishedAt?: string;
  excerpt?: string;
  /** Order of appearance in the post body (0-indexed). */
  positionInPost?: number;
}

export interface MediaSizes {
  thumb?: string;
  medium?: string;
  full?: string;
}

export interface Media {
  id: string;
  originalUrl: string;
  webpUrl?: string;
  avifUrl?: string;
  sizes: MediaSizes;
  altText?: string;
  caption?: string;
  postId?: string;
  uploadedBy?: string;
  uploadedAt: string;
}

export interface Revision {
  id: string;
  postId: string;
  bodySnapshot: string;
  titleSnapshot?: string;
  templateIdSnapshot?: TemplateId;
  aiVisibilityScore?: number;
  createdAt: string;
  createdBy?: string;
}

export interface Post {
  id: string;
  slug: string;
  title: string;
  bodyMdx: string;
  bodyHtml?: string;
  excerpt?: string;
  coverImageUrl?: string;
  status: PostStatus;
  publishAt?: string;
  publishedAt?: string;
  /** Last manual refresh — drives the freshness dashboard (PRD §18). */
  lastRefreshedAt?: string;
  authorId?: string;
  schemaType: SchemaType;
  templateId: TemplateId;
  /**
   * Template-specific fields that don't map to first-class columns.
   * Preserved across template switches so a Recipe → Article → Recipe
   * round-trip never loses the ingredient list (PRD §5D.3).
   */
  templateOverflow: Record<string, unknown>;
  canonicalUrl?: string;
  customMetaTitle?: string;
  customMetaDescription?: string;
  customOgImage?: string;
  noindex: boolean;
  readingTimeMinutes?: number;
  wordCount?: number;
  citationCount: number;
  faqJson?: FAQItem[];
  tldr?: string;
  /** Aggregate AI Visibility Score (geometric mean across six disciplines). */
  aiVisibilityScore?: number;
  /** Pinned at sitemap priority 1.0 regardless of age (PRD §18.5). */
  isCornerstone: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Page extends Omit<
  Post,
  "citationCount" | "faqJson" | "tldr" | "aiVisibilityScore" | "isCornerstone"
> {}

export interface Template {
  id: TemplateId;
  name: string;
  description?: string;
  isBuiltIn: boolean;
  fields: TemplateFieldSpec[];
  blocks: string[];
  schemaMapping: Record<string, unknown>;
  scoringRules: Record<string, unknown>;
  defaultLayout?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateFieldSpec {
  name: string;
  type:
    | "text"
    | "rich_text"
    | "image"
    | "number"
    | "date"
    | "select"
    | "multi_select"
    | "reference"
    | "json";
  required?: boolean;
  options?: string[];
  /** For `reference`: the target table (`posts`, `authors`, …). */
  references?: string;
}

export interface McpToken {
  id: string;
  name: string;
  scope: McpTokenScope;
  createdAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
  createdBy?: string;
}

// ---------- six-discipline scoring (PRD §5B) ----------
export interface DisciplineScore {
  /** 0–100. */
  score: number;
  fixes: ScoreFix[];
}

export interface ScoreFix {
  /** Discipline this fix improves — used to color-code in the UI. */
  discipline: ScoreDiscipline;
  /** Human-readable description. */
  message: string;
  /** Score points the fix is expected to add. */
  pointsImpact: number;
  /** `auto` = one-click apply; `writing` = needs the human to write. */
  effort: "auto" | "writing" | "config";
  /** Stable id so the editor can dedupe and persist applied state. */
  id: string;
}

export type ScoreDiscipline =
  | "seo"
  | "aeo"
  | "geo"
  | "aio"
  | "llmo"
  | "agentSeo";

export interface AiVisibilityReport {
  postId: string;
  templateId: TemplateId;
  scores: Record<ScoreDiscipline, DisciplineScore>;
  /** Geometric mean of the six discipline scores (PRD §5B.2). */
  aggregate: number;
  fixes: ScoreFix[];
  generatedAt: string;
}

// ---------- site config (resolved form, after defineConfig) ----------
export interface SiteConfig {
  name: string;
  url: string;
  tagline?: string;
  defaultAuthor?: string;
  defaultOgImage?: string;
}

export interface OrganizationConfig {
  name: string;
  logoUrl?: string;
  /** Wikidata, LinkedIn, Crunchbase, GitHub, … (PRD §6.6). */
  sameAs: string[];
}

export interface SeoConfig {
  defaultSchemaType: SchemaType;
  enforceCitations: boolean;
  /** Soft minimum (PRD §5.2 — three citations is the GEO sweet spot). */
  minCitations: number;
  /** Aggregate score required to publish. Default 70 (PRD §5B.4). */
  publishThreshold: number;
}

export interface AiConfig {
  /** `all` allows every documented AI crawler. `none` disallows all of them. */
  allowedCrawlers: "all" | "none" | string[];
  llmsTxtMaxLinks: number;
  /** Days after publish before a refresh is suggested (PRD §18.2). */
  freshnessWarningDays: number;
}

export interface McpConfig {
  enabled: boolean;
  /** HTTP mount path; `null` to disable HTTP transport. */
  mountPath: string | null;
}

export interface RoutesConfig {
  admin: string;
  blog: string;
}

export interface ResolvedBlogKitConfig {
  site: SiteConfig;
  organization: OrganizationConfig;
  storage: { provider: "supabase"; bucket: string };
  database: { provider: "supabase" };
  routes: RoutesConfig;
  seo: SeoConfig;
  ai: AiConfig;
  mcp: McpConfig;
  theme: string;
}
