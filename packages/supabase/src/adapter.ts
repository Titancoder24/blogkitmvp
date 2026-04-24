/**
 * `BlogKitAdapter` — the storage-provider interface.
 *
 * v1 ships only the Supabase implementation, but the surface is provider-
 * agnostic: future Firebase, MongoDB, Turso, and Postgres-direct adapters
 * (PRD §3.2) implement this same shape and pass the contract test suite.
 *
 * Contract tests live in `@blogkit/core/test/adapter-contract`. Any adapter
 * that fails the suite cannot ship (PRD §16.1).
 */
import type {
  Author,
  AuthorRole,
  Category,
  Citation,
  FAQItem,
  McpToken,
  McpTokenScope,
  Media,
  Page,
  Post,
  PostStatus,
  Revision,
  Tag,
  Template,
  TemplateId,
} from "@blogkit/core/types";

// ---------- queries ----------
export interface PostQuery {
  status?: PostStatus | PostStatus[];
  authorId?: string;
  tagSlug?: string;
  categorySlug?: string;
  templateId?: TemplateId;
  /** Inclusive lower bound on `published_at` (ISO 8601). */
  publishedSince?: string;
  /** Inclusive upper bound on `published_at` (ISO 8601). */
  publishedUntil?: string;
  /** Free-text query — adapters use Postgres FTS / equivalent. */
  search?: string;
  limit?: number;
  offset?: number;
  orderBy?: "published_at" | "created_at" | "updated_at" | "ai_visibility_score";
  orderDir?: "asc" | "desc";
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
}

// ---------- per-entity adapters ----------
export interface PostAdapter {
  list(query?: PostQuery): Promise<Post[]>;
  paginate(query?: PostQuery): Promise<PaginatedResult<Post>>;
  count(query?: PostQuery): Promise<number>;
  getById(id: string): Promise<Post | null>;
  getBySlug(slug: string): Promise<Post | null>;
  create(input: CreatePostInput): Promise<Post>;
  update(id: string, input: UpdatePostInput): Promise<Post>;
  delete(id: string): Promise<void>;

  /** Atomically transition `draft|in_review|scheduled` → `published`. */
  publish(id: string, opts?: { publishedAt?: string }): Promise<Post>;
  /** Atomically transition any state → `scheduled` with `publish_at`. */
  schedule(id: string, publishAt: string): Promise<Post>;
  /** Atomically transition any state → `archived`. */
  archive(id: string): Promise<Post>;

  /** Mark a post as freshly refreshed (PRD §18.1). */
  markRefreshed(id: string, at?: string): Promise<Post>;

  setTags(postId: string, tagIds: string[]): Promise<void>;
  setCategories(postId: string, categoryIds: string[]): Promise<void>;
  getTags(postId: string): Promise<Tag[]>;
  getCategories(postId: string): Promise<Category[]>;
}

export interface CreatePostInput {
  slug: string;
  title: string;
  bodyMdx?: string;
  excerpt?: string;
  coverImageUrl?: string;
  status?: PostStatus;
  authorId?: string;
  templateId?: TemplateId;
  templateOverflow?: Record<string, unknown>;
  tldr?: string;
  faqJson?: FAQItem[];
}

export interface UpdatePostInput extends Partial<CreatePostInput> {
  bodyHtml?: string;
  publishAt?: string | null;
  publishedAt?: string | null;
  canonicalUrl?: string | null;
  customMetaTitle?: string | null;
  customMetaDescription?: string | null;
  customOgImage?: string | null;
  noindex?: boolean;
  readingTimeMinutes?: number;
  wordCount?: number;
  citationCount?: number;
  aiVisibilityScore?: number | null;
  isCornerstone?: boolean;
}

export interface PageAdapter {
  list(): Promise<Page[]>;
  getBySlug(slug: string): Promise<Page | null>;
  create(input: CreatePostInput): Promise<Page>;
  update(id: string, input: UpdatePostInput): Promise<Page>;
  delete(id: string): Promise<void>;
}

export interface AuthorAdapter {
  list(): Promise<Author[]>;
  getById(id: string): Promise<Author | null>;
  getBySupabaseUserId(userId: string): Promise<Author | null>;
  create(input: Omit<Author, "id" | "createdAt" | "updatedAt">): Promise<Author>;
  update(id: string, input: Partial<Author>): Promise<Author>;
  setRole(id: string, role: AuthorRole): Promise<Author>;
  delete(id: string): Promise<void>;
}

export interface TagAdapter {
  list(): Promise<Tag[]>;
  getBySlug(slug: string): Promise<Tag | null>;
  create(input: Omit<Tag, "id">): Promise<Tag>;
  update(id: string, input: Partial<Omit<Tag, "id">>): Promise<Tag>;
  delete(id: string): Promise<void>;
}

export interface CategoryAdapter {
  list(): Promise<Category[]>;
  getBySlug(slug: string): Promise<Category | null>;
  create(input: Omit<Category, "id">): Promise<Category>;
  update(id: string, input: Partial<Omit<Category, "id">>): Promise<Category>;
  delete(id: string): Promise<void>;
}

export interface MediaAdapter {
  list(opts?: { postId?: string; limit?: number; offset?: number }): Promise<Media[]>;
  getById(id: string): Promise<Media | null>;
  /** Persist metadata for media that has already been uploaded to storage. */
  create(input: Omit<Media, "id" | "uploadedAt">): Promise<Media>;
  update(id: string, input: Partial<Media>): Promise<Media>;
  delete(id: string): Promise<void>;
}

export interface CitationAdapter {
  listByPost(postId: string): Promise<Citation[]>;
  create(input: Omit<Citation, "id">): Promise<Citation>;
  update(id: string, input: Partial<Omit<Citation, "id" | "postId">>): Promise<Citation>;
  delete(id: string): Promise<void>;
}

export interface RevisionAdapter {
  listByPost(postId: string, limit?: number): Promise<Revision[]>;
  getById(id: string): Promise<Revision | null>;
  create(input: Omit<Revision, "id" | "createdAt">): Promise<Revision>;
}

export interface TemplateAdapter {
  list(): Promise<Template[]>;
  getById(id: TemplateId): Promise<Template | null>;
  create(input: Omit<Template, "createdAt" | "updatedAt">): Promise<Template>;
  update(id: TemplateId, input: Partial<Template>): Promise<Template>;
  delete(id: TemplateId): Promise<void>;
}

export interface SettingsAdapter {
  get<T = unknown>(key: string): Promise<T | null>;
  set<T = unknown>(key: string, value: T): Promise<void>;
  list(prefix?: string): Promise<Record<string, unknown>>;
  delete(key: string): Promise<void>;
}

export interface McpTokenAdapter {
  list(): Promise<McpToken[]>;
  /**
   * Issue a new token. Returns the raw token (shown once to the operator)
   * plus the persisted record. Adapters are responsible for hashing.
   */
  issue(input: { name: string; scope: McpTokenScope; createdBy?: string }): Promise<{
    token: string;
    record: McpToken;
  }>;
  /** Look up by raw token; null if revoked or unknown. Updates `last_used_at`. */
  verify(rawToken: string): Promise<McpToken | null>;
  revoke(id: string): Promise<void>;
}

export interface AuditLogAdapter {
  record(entry: {
    actorType: "user" | "mcp_token" | "system";
    actorId?: string;
    action: string;
    targetType?: string;
    targetId?: string;
    payload?: Record<string, unknown>;
  }): Promise<void>;
  list(opts?: { limit?: number; actorId?: string; targetId?: string }): Promise<
    Array<{
      id: string;
      actorType: string;
      actorId?: string;
      action: string;
      targetType?: string;
      targetId?: string;
      payload?: Record<string, unknown>;
      createdAt: string;
    }>
  >;
}

// ---------- root ----------
export interface BlogKitAdapter {
  posts: PostAdapter;
  pages: PageAdapter;
  authors: AuthorAdapter;
  tags: TagAdapter;
  categories: CategoryAdapter;
  media: MediaAdapter;
  citations: CitationAdapter;
  revisions: RevisionAdapter;
  templates: TemplateAdapter;
  settings: SettingsAdapter;
  mcpTokens: McpTokenAdapter;
  audit: AuditLogAdapter;
}
