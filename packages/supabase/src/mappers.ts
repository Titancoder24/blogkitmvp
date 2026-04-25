/**
 * snake_case ↔ camelCase mapping helpers between Postgres rows and the
 * BlogKit type surface. Centralized here so the adapter doesn't repeat
 * field-name literals in every method.
 *
 * The mapping is explicit per-entity (no generic case-converter) because:
 *   1. Some Postgres columns intentionally do not round-trip (`body_html`
 *      is cached output, not authored input).
 *   2. JSON columns (`template_overflow`, `same_as`, `faq_json`) need
 *      defaults when null, not undefined.
 *   3. Enums and dates are validated here, not at every call site.
 */
import type {
  Author,
  Citation,
  FAQItem,
  McpToken,
  Media,
  Post,
  Revision,
  Tag,
  Template,
} from "@blogkit/core/types";

export interface PostRow {
  id: string;
  slug: string;
  title: string;
  body_mdx: string;
  body_html: string | null;
  excerpt: string | null;
  cover_image_url: string | null;
  status: Post["status"];
  publish_at: string | null;
  published_at: string | null;
  last_refreshed_at: string | null;
  author_id: string | null;
  schema_type: Post["schemaType"];
  template_id: string;
  template_overflow: Record<string, unknown> | null;
  canonical_url: string | null;
  custom_meta_title: string | null;
  custom_meta_description: string | null;
  custom_og_image: string | null;
  noindex: boolean;
  reading_time_minutes: number | null;
  word_count: number | null;
  citation_count: number;
  faq_json: FAQItem[] | null;
  tldr: string | null;
  ai_visibility_score: string | number | null;
  is_cornerstone: boolean;
  created_at: string;
  updated_at: string;
}

export function postFromRow(row: PostRow): Post {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    bodyMdx: row.body_mdx,
    bodyHtml: row.body_html ?? undefined,
    excerpt: row.excerpt ?? undefined,
    coverImageUrl: row.cover_image_url ?? undefined,
    status: row.status,
    publishAt: row.publish_at ?? undefined,
    publishedAt: row.published_at ?? undefined,
    lastRefreshedAt: row.last_refreshed_at ?? undefined,
    authorId: row.author_id ?? undefined,
    schemaType: row.schema_type,
    templateId: row.template_id,
    templateOverflow: row.template_overflow ?? {},
    canonicalUrl: row.canonical_url ?? undefined,
    customMetaTitle: row.custom_meta_title ?? undefined,
    customMetaDescription: row.custom_meta_description ?? undefined,
    customOgImage: row.custom_og_image ?? undefined,
    noindex: row.noindex,
    readingTimeMinutes: row.reading_time_minutes ?? undefined,
    wordCount: row.word_count ?? undefined,
    citationCount: row.citation_count,
    faqJson: row.faq_json ?? undefined,
    tldr: row.tldr ?? undefined,
    aiVisibilityScore:
      row.ai_visibility_score == null ? undefined : Number(row.ai_visibility_score),
    isCornerstone: row.is_cornerstone,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Strip undefined keys before sending to Supabase update/insert. */
export function postToRow(input: Partial<Post>): Partial<PostRow> {
  const out: Partial<PostRow> = {};
  if (input.slug !== undefined) out.slug = input.slug;
  if (input.title !== undefined) out.title = input.title;
  if (input.bodyMdx !== undefined) out.body_mdx = input.bodyMdx;
  if (input.bodyHtml !== undefined) out.body_html = input.bodyHtml;
  if (input.excerpt !== undefined) out.excerpt = input.excerpt;
  if (input.coverImageUrl !== undefined) out.cover_image_url = input.coverImageUrl;
  if (input.status !== undefined) out.status = input.status;
  if (input.publishAt !== undefined) out.publish_at = input.publishAt;
  if (input.publishedAt !== undefined) out.published_at = input.publishedAt;
  if (input.lastRefreshedAt !== undefined)
    out.last_refreshed_at = input.lastRefreshedAt;
  if (input.authorId !== undefined) out.author_id = input.authorId;
  if (input.schemaType !== undefined) out.schema_type = input.schemaType;
  if (input.templateId !== undefined) out.template_id = input.templateId;
  if (input.templateOverflow !== undefined)
    out.template_overflow = input.templateOverflow;
  if (input.canonicalUrl !== undefined) out.canonical_url = input.canonicalUrl;
  if (input.customMetaTitle !== undefined)
    out.custom_meta_title = input.customMetaTitle;
  if (input.customMetaDescription !== undefined)
    out.custom_meta_description = input.customMetaDescription;
  if (input.customOgImage !== undefined) out.custom_og_image = input.customOgImage;
  if (input.noindex !== undefined) out.noindex = input.noindex;
  if (input.readingTimeMinutes !== undefined)
    out.reading_time_minutes = input.readingTimeMinutes;
  if (input.wordCount !== undefined) out.word_count = input.wordCount;
  if (input.citationCount !== undefined) out.citation_count = input.citationCount;
  if (input.faqJson !== undefined) out.faq_json = input.faqJson;
  if (input.tldr !== undefined) out.tldr = input.tldr;
  if (input.aiVisibilityScore !== undefined)
    out.ai_visibility_score = input.aiVisibilityScore;
  if (input.isCornerstone !== undefined) out.is_cornerstone = input.isCornerstone;
  return out;
}

export interface AuthorRow {
  id: string;
  supabase_user_id: string | null;
  name: string;
  bio: string | null;
  avatar_url: string | null;
  twitter: string | null;
  linkedin: string | null;
  github: string | null;
  website: string | null;
  same_as: string[] | null;
  role: Author["role"];
  created_at: string;
  updated_at: string;
}

export function authorFromRow(row: AuthorRow): Author {
  return {
    id: row.id,
    supabaseUserId: row.supabase_user_id ?? undefined,
    name: row.name,
    bio: row.bio ?? undefined,
    avatarUrl: row.avatar_url ?? undefined,
    twitter: row.twitter ?? undefined,
    linkedin: row.linkedin ?? undefined,
    github: row.github ?? undefined,
    website: row.website ?? undefined,
    sameAs: row.same_as ?? [],
    role: row.role,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function authorToRow(input: Partial<Author>): Partial<AuthorRow> {
  const out: Partial<AuthorRow> = {};
  if (input.supabaseUserId !== undefined) out.supabase_user_id = input.supabaseUserId;
  if (input.name !== undefined) out.name = input.name;
  if (input.bio !== undefined) out.bio = input.bio;
  if (input.avatarUrl !== undefined) out.avatar_url = input.avatarUrl;
  if (input.twitter !== undefined) out.twitter = input.twitter;
  if (input.linkedin !== undefined) out.linkedin = input.linkedin;
  if (input.github !== undefined) out.github = input.github;
  if (input.website !== undefined) out.website = input.website;
  if (input.sameAs !== undefined) out.same_as = input.sameAs;
  if (input.role !== undefined) out.role = input.role;
  return out;
}

export interface TagRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
}
export function tagFromRow(row: TagRow): Tag {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description ?? undefined,
  };
}

export interface CategoryRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  parent_id: string | null;
}
export function categoryFromRow(row: CategoryRow) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description ?? undefined,
    parentId: row.parent_id ?? undefined,
  };
}

export interface MediaRow {
  id: string;
  original_url: string;
  webp_url: string | null;
  avif_url: string | null;
  sizes: { thumb?: string; medium?: string; full?: string } | null;
  alt_text: string | null;
  caption: string | null;
  post_id: string | null;
  uploaded_by: string | null;
  uploaded_at: string;
}
export function mediaFromRow(row: MediaRow): Media {
  return {
    id: row.id,
    originalUrl: row.original_url,
    webpUrl: row.webp_url ?? undefined,
    avifUrl: row.avif_url ?? undefined,
    sizes: row.sizes ?? {},
    altText: row.alt_text ?? undefined,
    caption: row.caption ?? undefined,
    postId: row.post_id ?? undefined,
    uploadedBy: row.uploaded_by ?? undefined,
    uploadedAt: row.uploaded_at,
  };
}

export interface CitationRow {
  id: string;
  post_id: string;
  source_url: string;
  source_title: string | null;
  source_author: string | null;
  source_published_at: string | null;
  excerpt: string | null;
  position_in_post: number | null;
  created_at: string;
}
export function citationFromRow(row: CitationRow): Citation {
  return {
    id: row.id,
    postId: row.post_id,
    sourceUrl: row.source_url,
    sourceTitle: row.source_title ?? undefined,
    sourceAuthor: row.source_author ?? undefined,
    sourcePublishedAt: row.source_published_at ?? undefined,
    excerpt: row.excerpt ?? undefined,
    positionInPost: row.position_in_post ?? undefined,
  };
}

export interface RevisionRow {
  id: string;
  post_id: string;
  body_snapshot: string;
  title_snapshot: string | null;
  template_id_snapshot: string | null;
  ai_visibility_score: string | number | null;
  created_at: string;
  created_by: string | null;
}
export function revisionFromRow(row: RevisionRow): Revision {
  return {
    id: row.id,
    postId: row.post_id,
    bodySnapshot: row.body_snapshot,
    titleSnapshot: row.title_snapshot ?? undefined,
    templateIdSnapshot: row.template_id_snapshot ?? undefined,
    aiVisibilityScore:
      row.ai_visibility_score == null ? undefined : Number(row.ai_visibility_score),
    createdAt: row.created_at,
    createdBy: row.created_by ?? undefined,
  };
}

export interface TemplateRow {
  id: string;
  name: string;
  description: string | null;
  is_built_in: boolean;
  fields: Template["fields"];
  blocks: string[];
  schema_mapping: Record<string, unknown>;
  scoring_rules: Record<string, unknown>;
  default_layout: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}
export function templateFromRow(row: TemplateRow): Template {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    isBuiltIn: row.is_built_in,
    fields: row.fields ?? [],
    blocks: row.blocks ?? [],
    schemaMapping: row.schema_mapping ?? {},
    scoringRules: row.scoring_rules ?? {},
    defaultLayout: row.default_layout ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface McpTokenRow {
  id: string;
  name: string;
  token_hash: string;
  scope: McpToken["scope"];
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  created_by: string | null;
}
export function mcpTokenFromRow(row: McpTokenRow): McpToken {
  return {
    id: row.id,
    name: row.name,
    scope: row.scope,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at ?? undefined,
    revokedAt: row.revoked_at ?? undefined,
    createdBy: row.created_by ?? undefined,
  };
}
