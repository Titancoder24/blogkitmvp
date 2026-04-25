/**
 * `createSupabaseAdapter` — concrete `BlogKitAdapter` over Supabase.
 *
 * Notes on auth:
 *   - The adapter is constructed from a `SupabaseClient`. Server code
 *     supplies a client created with the **service role key**; that client
 *     bypasses RLS and is used by the framework adapters and the CLI.
 *   - For per-user requests in the admin app, callers create a separate
 *     client with the user's session JWT and construct a per-request
 *     adapter — RLS then enforces the role-based policies in 0002.
 *
 * Notes on hashing MCP tokens:
 *   - We use SubtleCrypto's SHA-256. The raw token is shown to the
 *     operator once at creation; only the hash is persisted.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Author,
  Category,
  Citation,
  McpToken,
  Media,
  Page,
  Post,
  Revision,
  Tag,
  Template,
} from "@blogkit/core/types";
import type {
  AuditLogAdapter,
  AuthorAdapter,
  BlogKitAdapter,
  CategoryAdapter,
  CitationAdapter,
  CreatePostInput,
  McpTokenAdapter,
  MediaAdapter,
  PaginatedResult,
  PageAdapter,
  PostAdapter,
  PostQuery,
  RevisionAdapter,
  SettingsAdapter,
  TagAdapter,
  TemplateAdapter,
  UpdatePostInput,
} from "./adapter.js";
import {
  authorFromRow,
  authorToRow,
  categoryFromRow,
  citationFromRow,
  mcpTokenFromRow,
  mediaFromRow,
  postFromRow,
  postToRow,
  revisionFromRow,
  tagFromRow,
  templateFromRow,
} from "./mappers.js";

export interface CreateAdapterOptions {
  client: SupabaseClient;
  /**
   * Optional override for the random-token generator. Defaults to
   * `crypto.randomUUID()` × 2 concatenated. Tests override this for
   * deterministic output.
   */
  generateToken?: () => string;
}

export function createSupabaseAdapter(opts: CreateAdapterOptions): BlogKitAdapter {
  const client = opts.client;
  const generateToken =
    opts.generateToken ??
    (() => `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, ""));

  return {
    posts: createPostAdapter(client),
    pages: createPageAdapter(client),
    authors: createAuthorAdapter(client),
    tags: createTagAdapter(client),
    categories: createCategoryAdapter(client),
    media: createMediaAdapter(client),
    citations: createCitationAdapter(client),
    revisions: createRevisionAdapter(client),
    templates: createTemplateAdapter(client),
    settings: createSettingsAdapter(client),
    mcpTokens: createMcpTokenAdapter(client, generateToken),
    audit: createAuditLogAdapter(client),
  };
}

// ---------- shared error wrapper ----------
function unwrap<T>({ data, error }: { data: T | null; error: { message: string } | null }): T {
  if (error) throw new Error(`Supabase: ${error.message}`);
  if (data == null) throw new Error("Supabase: empty response");
  return data;
}

function unwrapMaybe<T>({
  data,
  error,
}: {
  data: T | null;
  error: { message: string; code?: string } | null;
}): T | null {
  if (error) {
    // PGRST116 = "Results contain 0 rows" from .single()
    if (error.code === "PGRST116") return null;
    throw new Error(`Supabase: ${error.message}`);
  }
  return data;
}

// ---------- posts ----------
function createPostAdapter(client: SupabaseClient): PostAdapter {
  function applyQuery(builder: any, query?: PostQuery) {
    if (!query) return builder;
    if (query.status) {
      const statuses = Array.isArray(query.status) ? query.status : [query.status];
      builder = builder.in("status", statuses);
    }
    if (query.authorId) builder = builder.eq("author_id", query.authorId);
    if (query.templateId) builder = builder.eq("template_id", query.templateId);
    if (query.publishedSince) builder = builder.gte("published_at", query.publishedSince);
    if (query.publishedUntil) builder = builder.lte("published_at", query.publishedUntil);
    if (query.search) {
      const fts = query.search.replace(/[':&|!()]/g, " ").trim().split(/\s+/).join(" & ");
      if (fts) builder = builder.textSearch("body_mdx", fts, { config: "english" });
    }
    if (query.orderBy) {
      builder = builder.order(query.orderBy, {
        ascending: query.orderDir === "asc",
      });
    } else {
      builder = builder.order("published_at", { ascending: false, nullsFirst: false });
    }
    if (query.limit) builder = builder.limit(query.limit);
    if (query.offset !== undefined) {
      const from = query.offset;
      const to = from + (query.limit ?? 50) - 1;
      builder = builder.range(from, to);
    }
    return builder;
  }

  return {
    async list(query?: PostQuery): Promise<Post[]> {
      let builder = client.from("blogkit_posts").select("*");
      if (query?.tagSlug) builder = await joinTagFilter(client, builder, query.tagSlug);
      if (query?.categorySlug)
        builder = await joinCategoryFilter(client, builder, query.categorySlug);
      builder = applyQuery(builder, query);
      const rows = unwrap<any[]>(await builder);
      return rows.map(postFromRow);
    },

    async paginate(query?: PostQuery): Promise<PaginatedResult<Post>> {
      const [items, total] = await Promise.all([
        this.list(query),
        this.count(query),
      ]);
      return { items, total };
    },

    async count(query?: PostQuery): Promise<number> {
      let builder = client
        .from("blogkit_posts")
        .select("id", { count: "exact", head: true });
      builder = applyQuery(builder, { ...query, limit: undefined, offset: undefined });
      const { count, error } = await builder;
      if (error) throw new Error(`Supabase: ${error.message}`);
      return count ?? 0;
    },

    async getById(id: string): Promise<Post | null> {
      const row = unwrapMaybe<any>(
        await client.from("blogkit_posts").select("*").eq("id", id).maybeSingle(),
      );
      return row ? postFromRow(row) : null;
    },

    async getBySlug(slug: string): Promise<Post | null> {
      const row = unwrapMaybe<any>(
        await client.from("blogkit_posts").select("*").eq("slug", slug).maybeSingle(),
      );
      return row ? postFromRow(row) : null;
    },

    async create(input: CreatePostInput): Promise<Post> {
      const row = unwrap<any>(
        await client
          .from("blogkit_posts")
          .insert(postToRow(asPartialPost(input)))
          .select("*")
          .single(),
      );
      return postFromRow(row);
    },

    async update(id: string, input: UpdatePostInput): Promise<Post> {
      const row = unwrap<any>(
        await client
          .from("blogkit_posts")
          .update(postToRow(input as Partial<Post>))
          .eq("id", id)
          .select("*")
          .single(),
      );
      return postFromRow(row);
    },

    async delete(id: string): Promise<void> {
      const { error } = await client.from("blogkit_posts").delete().eq("id", id);
      if (error) throw new Error(`Supabase: ${error.message}`);
    },

    async publish(id, opts): Promise<Post> {
      return this.update(id, {
        status: "published",
        publishedAt: opts?.publishedAt ?? new Date().toISOString(),
        publishAt: null,
      });
    },

    async schedule(id, publishAt): Promise<Post> {
      return this.update(id, { status: "scheduled", publishAt });
    },

    async archive(id): Promise<Post> {
      return this.update(id, { status: "archived" });
    },

    async markRefreshed(id, at): Promise<Post> {
      return this.update(id, { lastRefreshedAt: at ?? new Date().toISOString() });
    },

    async setTags(postId: string, tagIds: string[]): Promise<void> {
      const { error: deleteError } = await client
        .from("blogkit_post_tags")
        .delete()
        .eq("post_id", postId);
      if (deleteError) throw new Error(`Supabase: ${deleteError.message}`);
      if (tagIds.length === 0) return;
      const { error } = await client
        .from("blogkit_post_tags")
        .insert(tagIds.map((tagId) => ({ post_id: postId, tag_id: tagId })));
      if (error) throw new Error(`Supabase: ${error.message}`);
    },

    async setCategories(postId: string, categoryIds: string[]): Promise<void> {
      const { error: deleteError } = await client
        .from("blogkit_post_categories")
        .delete()
        .eq("post_id", postId);
      if (deleteError) throw new Error(`Supabase: ${deleteError.message}`);
      if (categoryIds.length === 0) return;
      const { error } = await client
        .from("blogkit_post_categories")
        .insert(
          categoryIds.map((categoryId) => ({ post_id: postId, category_id: categoryId })),
        );
      if (error) throw new Error(`Supabase: ${error.message}`);
    },

    async getTags(postId: string): Promise<Tag[]> {
      const rows = unwrap<any[]>(
        await client
          .from("blogkit_post_tags")
          .select("blogkit_tags!inner(*)")
          .eq("post_id", postId),
      );
      return rows.map((r: any) => tagFromRow(r.blogkit_tags));
    },

    async getCategories(postId: string): Promise<Category[]> {
      const rows = unwrap<any[]>(
        await client
          .from("blogkit_post_categories")
          .select("blogkit_categories!inner(*)")
          .eq("post_id", postId),
      );
      return rows.map((r: any) => categoryFromRow(r.blogkit_categories));
    },
  };
}

async function joinTagFilter(client: SupabaseClient, builder: any, tagSlug: string) {
  const { data: tag } = await client
    .from("blogkit_tags")
    .select("id")
    .eq("slug", tagSlug)
    .maybeSingle();
  if (!tag) return builder.in("id", []);
  const { data: rows } = await client
    .from("blogkit_post_tags")
    .select("post_id")
    .eq("tag_id", tag.id);
  const ids = (rows ?? []).map((r: any) => r.post_id);
  return builder.in("id", ids.length === 0 ? [""] : ids);
}

async function joinCategoryFilter(client: SupabaseClient, builder: any, slug: string) {
  const { data: cat } = await client
    .from("blogkit_categories")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  if (!cat) return builder.in("id", []);
  const { data: rows } = await client
    .from("blogkit_post_categories")
    .select("post_id")
    .eq("category_id", cat.id);
  const ids = (rows ?? []).map((r: any) => r.post_id);
  return builder.in("id", ids.length === 0 ? [""] : ids);
}

function asPartialPost(input: CreatePostInput): Partial<Post> {
  return {
    slug: input.slug,
    title: input.title,
    bodyMdx: input.bodyMdx ?? "",
    excerpt: input.excerpt,
    coverImageUrl: input.coverImageUrl,
    status: input.status ?? "draft",
    authorId: input.authorId,
    templateId: input.templateId ?? "article",
    templateOverflow: input.templateOverflow ?? {},
    tldr: input.tldr,
    faqJson: input.faqJson,
  };
}

// ---------- pages (mirrors posts on the same shape) ----------
function createPageAdapter(client: SupabaseClient): PageAdapter {
  return {
    async list(): Promise<Page[]> {
      const rows = unwrap<any[]>(await client.from("blogkit_pages").select("*"));
      return rows.map(postFromRow) as unknown as Page[];
    },
    async getBySlug(slug: string): Promise<Page | null> {
      const row = unwrapMaybe<any>(
        await client.from("blogkit_pages").select("*").eq("slug", slug).maybeSingle(),
      );
      return row ? (postFromRow(row) as unknown as Page) : null;
    },
    async create(input): Promise<Page> {
      const row = unwrap<any>(
        await client
          .from("blogkit_pages")
          .insert(postToRow(asPartialPost(input)))
          .select("*")
          .single(),
      );
      return postFromRow(row) as unknown as Page;
    },
    async update(id, input): Promise<Page> {
      const row = unwrap<any>(
        await client
          .from("blogkit_pages")
          .update(postToRow(input as Partial<Post>))
          .eq("id", id)
          .select("*")
          .single(),
      );
      return postFromRow(row) as unknown as Page;
    },
    async delete(id) {
      const { error } = await client.from("blogkit_pages").delete().eq("id", id);
      if (error) throw new Error(`Supabase: ${error.message}`);
    },
  };
}

// ---------- authors ----------
function createAuthorAdapter(client: SupabaseClient): AuthorAdapter {
  return {
    async list() {
      const rows = unwrap<any[]>(
        await client.from("blogkit_authors").select("*").order("name"),
      );
      return rows.map(authorFromRow);
    },
    async getById(id) {
      const row = unwrapMaybe<any>(
        await client.from("blogkit_authors").select("*").eq("id", id).maybeSingle(),
      );
      return row ? authorFromRow(row) : null;
    },
    async getBySupabaseUserId(userId) {
      const row = unwrapMaybe<any>(
        await client
          .from("blogkit_authors")
          .select("*")
          .eq("supabase_user_id", userId)
          .maybeSingle(),
      );
      return row ? authorFromRow(row) : null;
    },
    async create(input) {
      const row = unwrap<any>(
        await client
          .from("blogkit_authors")
          .insert(authorToRow(input as Partial<Author>))
          .select("*")
          .single(),
      );
      return authorFromRow(row);
    },
    async update(id, input) {
      const row = unwrap<any>(
        await client
          .from("blogkit_authors")
          .update(authorToRow(input))
          .eq("id", id)
          .select("*")
          .single(),
      );
      return authorFromRow(row);
    },
    async setRole(id, role) {
      return this.update(id, { role });
    },
    async delete(id) {
      const { error } = await client.from("blogkit_authors").delete().eq("id", id);
      if (error) throw new Error(`Supabase: ${error.message}`);
    },
  };
}

// ---------- tags ----------
function createTagAdapter(client: SupabaseClient): TagAdapter {
  return {
    async list() {
      const rows = unwrap<any[]>(
        await client.from("blogkit_tags").select("*").order("name"),
      );
      return rows.map(tagFromRow);
    },
    async getBySlug(slug) {
      const row = unwrapMaybe<any>(
        await client.from("blogkit_tags").select("*").eq("slug", slug).maybeSingle(),
      );
      return row ? tagFromRow(row) : null;
    },
    async create(input) {
      const row = unwrap<any>(
        await client.from("blogkit_tags").insert(input).select("*").single(),
      );
      return tagFromRow(row);
    },
    async update(id, input) {
      const row = unwrap<any>(
        await client
          .from("blogkit_tags")
          .update(input)
          .eq("id", id)
          .select("*")
          .single(),
      );
      return tagFromRow(row);
    },
    async delete(id) {
      const { error } = await client.from("blogkit_tags").delete().eq("id", id);
      if (error) throw new Error(`Supabase: ${error.message}`);
    },
  };
}

// ---------- categories ----------
function createCategoryAdapter(client: SupabaseClient): CategoryAdapter {
  return {
    async list() {
      const rows = unwrap<any[]>(
        await client.from("blogkit_categories").select("*").order("name"),
      );
      return rows.map(categoryFromRow);
    },
    async getBySlug(slug) {
      const row = unwrapMaybe<any>(
        await client
          .from("blogkit_categories")
          .select("*")
          .eq("slug", slug)
          .maybeSingle(),
      );
      return row ? categoryFromRow(row) : null;
    },
    async create(input) {
      const payload = {
        name: input.name,
        slug: input.slug,
        description: input.description ?? null,
        parent_id: input.parentId ?? null,
      };
      const row = unwrap<any>(
        await client.from("blogkit_categories").insert(payload).select("*").single(),
      );
      return categoryFromRow(row);
    },
    async update(id, input) {
      const payload: Record<string, unknown> = {};
      if (input.name !== undefined) payload.name = input.name;
      if (input.slug !== undefined) payload.slug = input.slug;
      if (input.description !== undefined) payload.description = input.description;
      if (input.parentId !== undefined) payload.parent_id = input.parentId;
      const row = unwrap<any>(
        await client
          .from("blogkit_categories")
          .update(payload)
          .eq("id", id)
          .select("*")
          .single(),
      );
      return categoryFromRow(row);
    },
    async delete(id) {
      const { error } = await client.from("blogkit_categories").delete().eq("id", id);
      if (error) throw new Error(`Supabase: ${error.message}`);
    },
  };
}

// ---------- media ----------
function createMediaAdapter(client: SupabaseClient): MediaAdapter {
  return {
    async list(opts) {
      let builder = client
        .from("blogkit_media")
        .select("*")
        .order("uploaded_at", { ascending: false });
      if (opts?.postId) builder = builder.eq("post_id", opts.postId);
      if (opts?.limit) builder = builder.limit(opts.limit);
      if (opts?.offset !== undefined) {
        const from = opts.offset;
        const to = from + (opts.limit ?? 50) - 1;
        builder = builder.range(from, to);
      }
      const rows = unwrap<any[]>(await builder);
      return rows.map(mediaFromRow);
    },
    async getById(id) {
      const row = unwrapMaybe<any>(
        await client.from("blogkit_media").select("*").eq("id", id).maybeSingle(),
      );
      return row ? mediaFromRow(row) : null;
    },
    async create(input) {
      const payload = {
        original_url: input.originalUrl,
        webp_url: input.webpUrl ?? null,
        avif_url: input.avifUrl ?? null,
        sizes: input.sizes ?? {},
        alt_text: input.altText ?? null,
        caption: input.caption ?? null,
        post_id: input.postId ?? null,
        uploaded_by: input.uploadedBy ?? null,
      };
      const row = unwrap<any>(
        await client.from("blogkit_media").insert(payload).select("*").single(),
      );
      return mediaFromRow(row);
    },
    async update(id, input) {
      const payload: Record<string, unknown> = {};
      if (input.altText !== undefined) payload.alt_text = input.altText;
      if (input.caption !== undefined) payload.caption = input.caption;
      if (input.postId !== undefined) payload.post_id = input.postId;
      const row = unwrap<any>(
        await client
          .from("blogkit_media")
          .update(payload)
          .eq("id", id)
          .select("*")
          .single(),
      );
      return mediaFromRow(row);
    },
    async delete(id) {
      const { error } = await client.from("blogkit_media").delete().eq("id", id);
      if (error) throw new Error(`Supabase: ${error.message}`);
    },
  };
}

// ---------- citations ----------
function createCitationAdapter(client: SupabaseClient): CitationAdapter {
  return {
    async listByPost(postId): Promise<Citation[]> {
      const rows = unwrap<any[]>(
        await client
          .from("blogkit_citations")
          .select("*")
          .eq("post_id", postId)
          .order("position_in_post", { ascending: true, nullsFirst: false }),
      );
      return rows.map(citationFromRow);
    },
    async create(input) {
      const payload = {
        post_id: input.postId,
        source_url: input.sourceUrl,
        source_title: input.sourceTitle ?? null,
        source_author: input.sourceAuthor ?? null,
        source_published_at: input.sourcePublishedAt ?? null,
        excerpt: input.excerpt ?? null,
        position_in_post: input.positionInPost ?? null,
      };
      const row = unwrap<any>(
        await client.from("blogkit_citations").insert(payload).select("*").single(),
      );
      return citationFromRow(row);
    },
    async update(id, input) {
      const payload: Record<string, unknown> = {};
      if (input.sourceUrl !== undefined) payload.source_url = input.sourceUrl;
      if (input.sourceTitle !== undefined) payload.source_title = input.sourceTitle;
      if (input.sourceAuthor !== undefined) payload.source_author = input.sourceAuthor;
      if (input.sourcePublishedAt !== undefined)
        payload.source_published_at = input.sourcePublishedAt;
      if (input.excerpt !== undefined) payload.excerpt = input.excerpt;
      if (input.positionInPost !== undefined)
        payload.position_in_post = input.positionInPost;
      const row = unwrap<any>(
        await client
          .from("blogkit_citations")
          .update(payload)
          .eq("id", id)
          .select("*")
          .single(),
      );
      return citationFromRow(row);
    },
    async delete(id) {
      const { error } = await client.from("blogkit_citations").delete().eq("id", id);
      if (error) throw new Error(`Supabase: ${error.message}`);
    },
  };
}

// ---------- revisions ----------
function createRevisionAdapter(client: SupabaseClient): RevisionAdapter {
  return {
    async listByPost(postId, limit = 50): Promise<Revision[]> {
      const rows = unwrap<any[]>(
        await client
          .from("blogkit_revisions")
          .select("*")
          .eq("post_id", postId)
          .order("created_at", { ascending: false })
          .limit(limit),
      );
      return rows.map(revisionFromRow);
    },
    async getById(id) {
      const row = unwrapMaybe<any>(
        await client.from("blogkit_revisions").select("*").eq("id", id).maybeSingle(),
      );
      return row ? revisionFromRow(row) : null;
    },
    async create(input) {
      const payload = {
        post_id: input.postId,
        body_snapshot: input.bodySnapshot,
        title_snapshot: input.titleSnapshot ?? null,
        template_id_snapshot: input.templateIdSnapshot ?? null,
        ai_visibility_score: input.aiVisibilityScore ?? null,
        created_by: input.createdBy ?? null,
      };
      const row = unwrap<any>(
        await client.from("blogkit_revisions").insert(payload).select("*").single(),
      );
      return revisionFromRow(row);
    },
  };
}

// ---------- templates ----------
function createTemplateAdapter(client: SupabaseClient): TemplateAdapter {
  return {
    async list(): Promise<Template[]> {
      const rows = unwrap<any[]>(
        await client.from("blogkit_templates").select("*").order("id"),
      );
      return rows.map(templateFromRow);
    },
    async getById(id) {
      const row = unwrapMaybe<any>(
        await client.from("blogkit_templates").select("*").eq("id", id).maybeSingle(),
      );
      return row ? templateFromRow(row) : null;
    },
    async create(input) {
      const payload = {
        id: input.id,
        name: input.name,
        description: input.description ?? null,
        is_built_in: input.isBuiltIn,
        fields: input.fields,
        blocks: input.blocks,
        schema_mapping: input.schemaMapping,
        scoring_rules: input.scoringRules,
        default_layout: input.defaultLayout ?? null,
      };
      const row = unwrap<any>(
        await client.from("blogkit_templates").insert(payload).select("*").single(),
      );
      return templateFromRow(row);
    },
    async update(id, input) {
      const payload: Record<string, unknown> = {};
      if (input.name !== undefined) payload.name = input.name;
      if (input.description !== undefined) payload.description = input.description;
      if (input.fields !== undefined) payload.fields = input.fields;
      if (input.blocks !== undefined) payload.blocks = input.blocks;
      if (input.schemaMapping !== undefined) payload.schema_mapping = input.schemaMapping;
      if (input.scoringRules !== undefined) payload.scoring_rules = input.scoringRules;
      if (input.defaultLayout !== undefined) payload.default_layout = input.defaultLayout;
      const row = unwrap<any>(
        await client
          .from("blogkit_templates")
          .update(payload)
          .eq("id", id)
          .select("*")
          .single(),
      );
      return templateFromRow(row);
    },
    async delete(id) {
      const { error } = await client.from("blogkit_templates").delete().eq("id", id);
      if (error) throw new Error(`Supabase: ${error.message}`);
    },
  };
}

// ---------- settings ----------
function createSettingsAdapter(client: SupabaseClient): SettingsAdapter {
  return {
    async get<T = unknown>(key: string): Promise<T | null> {
      const row = unwrapMaybe<{ value: T }>(
        await client
          .from("blogkit_settings")
          .select("value")
          .eq("key", key)
          .maybeSingle(),
      );
      return row ? (row.value as T) : null;
    },
    async set(key, value) {
      const { error } = await client
        .from("blogkit_settings")
        .upsert({ key, value, updated_at: new Date().toISOString() });
      if (error) throw new Error(`Supabase: ${error.message}`);
    },
    async list(prefix) {
      let builder = client.from("blogkit_settings").select("key,value");
      if (prefix) builder = builder.like("key", `${prefix}%`);
      const rows = unwrap<{ key: string; value: unknown }[]>(await builder);
      const out: Record<string, unknown> = {};
      for (const r of rows) out[r.key] = r.value;
      return out;
    },
    async delete(key) {
      const { error } = await client.from("blogkit_settings").delete().eq("key", key);
      if (error) throw new Error(`Supabase: ${error.message}`);
    },
  };
}

// ---------- mcp_tokens ----------
async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function createMcpTokenAdapter(
  client: SupabaseClient,
  generateToken: () => string,
): McpTokenAdapter {
  return {
    async list(): Promise<McpToken[]> {
      const rows = unwrap<any[]>(
        await client
          .from("blogkit_mcp_tokens")
          .select("*")
          .order("created_at", { ascending: false }),
      );
      return rows.map(mcpTokenFromRow);
    },

    async issue({ name, scope, createdBy }) {
      const raw = `bk_${generateToken()}`;
      const hash = await sha256Hex(raw);
      const row = unwrap<any>(
        await client
          .from("blogkit_mcp_tokens")
          .insert({
            name,
            scope,
            token_hash: hash,
            created_by: createdBy ?? null,
          })
          .select("*")
          .single(),
      );
      return { token: raw, record: mcpTokenFromRow(row) };
    },

    async verify(rawToken) {
      const hash = await sha256Hex(rawToken);
      const row = unwrapMaybe<any>(
        await client
          .from("blogkit_mcp_tokens")
          .select("*")
          .eq("token_hash", hash)
          .is("revoked_at", null)
          .maybeSingle(),
      );
      if (!row) return null;
      // best-effort touch of last_used_at; a failure here is non-fatal.
      void client
        .from("blogkit_mcp_tokens")
        .update({ last_used_at: new Date().toISOString() })
        .eq("id", row.id);
      return mcpTokenFromRow(row);
    },

    async revoke(id) {
      const { error } = await client
        .from("blogkit_mcp_tokens")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw new Error(`Supabase: ${error.message}`);
    },
  };
}

// ---------- audit log ----------
function createAuditLogAdapter(client: SupabaseClient): AuditLogAdapter {
  return {
    async record(entry) {
      const { error } = await client.from("blogkit_audit_log").insert({
        actor_type: entry.actorType,
        actor_id: entry.actorId ?? null,
        action: entry.action,
        target_type: entry.targetType ?? null,
        target_id: entry.targetId ?? null,
        payload: entry.payload ?? null,
      });
      if (error) throw new Error(`Supabase: ${error.message}`);
    },
    async list(opts) {
      let builder = client
        .from("blogkit_audit_log")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(opts?.limit ?? 100);
      if (opts?.actorId) builder = builder.eq("actor_id", opts.actorId);
      if (opts?.targetId) builder = builder.eq("target_id", opts.targetId);
      const rows = unwrap<any[]>(await builder);
      return rows.map((r: any) => ({
        id: r.id,
        actorType: r.actor_type,
        actorId: r.actor_id ?? undefined,
        action: r.action,
        targetType: r.target_type ?? undefined,
        targetId: r.target_id ?? undefined,
        payload: r.payload ?? undefined,
        createdAt: r.created_at,
      }));
    },
  };
}
