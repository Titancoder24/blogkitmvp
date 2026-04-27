/**
 * MCP tool handlers — pure async functions that take a `BlogKitAdapter`
 * and the tool's input args and return a structured result. Wiring up
 * the actual MCP transport (stdio or HTTP/SSE) is a thin layer on top.
 *
 * Each handler emits one row to the audit log on success, with the actor
 * supplied by the transport (a token id for HTTP, "system" for stdio).
 */
import type { Post, SiteConfig } from "@blogkit/core/types";
import {
  analyzeTopicGaps,
  buildVisibilityReport,
  pickWinner,
  scoreVoice,
  suggestAltText,
  type HeadlineVariant,
  type ScoreSiteState,
  type VoiceGuide,
} from "@blogkit/scoring";
import { summarizeMentions } from "@blogkit/intelligence";
import type { BlogKitAdapter } from "@blogkit/supabase/adapter";
import { agentHandlers } from "./agent-tools.js";

export interface HandlerContext {
  adapter: BlogKitAdapter;
  /** "user", "mcp_token", or "system" — used in the audit log. */
  actorType: "user" | "mcp_token" | "system";
  actorId?: string;
  /** Site state for scoring (resolved from settings). */
  scoringSite?: ScoreSiteState;
}

export type Handler = (ctx: HandlerContext, args: Record<string, unknown>) => Promise<unknown>;

export const handlers: Record<string, Handler> = {
  async list_posts(ctx, args) {
    return ctx.adapter.posts.list({
      status: args.status as Post["status"] | undefined,
      tagSlug: args.tag as string | undefined,
      categorySlug: args.category as string | undefined,
      authorId: args.author_id as string | undefined,
      publishedSince: args.published_since as string | undefined,
      publishedUntil: args.published_until as string | undefined,
      limit: typeof args.limit === "number" ? args.limit : 25,
      offset: typeof args.offset === "number" ? args.offset : 0,
    });
  },

  async get_post(ctx, args) {
    const post = args.id
      ? await ctx.adapter.posts.getById(String(args.id))
      : args.slug
      ? await ctx.adapter.posts.getBySlug(String(args.slug))
      : null;
    if (!post) return null;
    const [author, tags, categories, citations] = await Promise.all([
      post.authorId ? ctx.adapter.authors.getById(post.authorId) : null,
      ctx.adapter.posts.getTags(post.id),
      ctx.adapter.posts.getCategories(post.id),
      ctx.adapter.citations.listByPost(post.id),
    ]);
    return { post, author, tags, categories, citations };
  },

  async search_posts(ctx, args) {
    return ctx.adapter.posts.list({
      status: "published",
      search: String(args.query),
      limit: typeof args.limit === "number" ? args.limit : 10,
    });
  },

  async create_post(ctx, args) {
    requireScope(ctx, "write");
    const title = String(args.title);
    const slug = (args.slug as string | undefined) ?? slugify(title);
    const tagSlugs = (args.tags as string[] | undefined) ?? [];
    const post = await ctx.adapter.posts.create({
      title,
      slug,
      bodyMdx: (args.body_mdx as string | undefined) ?? "",
      excerpt: args.excerpt as string | undefined,
      tldr: args.tldr as string | undefined,
      coverImageUrl: args.cover_image_url as string | undefined,
      templateId: (args.template_id as string | undefined) ?? "article",
      authorId: args.author_id as string | undefined,
    });
    if (tagSlugs.length > 0) {
      const tagIds = await resolveTagIds(ctx, tagSlugs);
      await ctx.adapter.posts.setTags(post.id, tagIds);
    }
    await audit(ctx, "post.create", { id: post.id, slug: post.slug });
    return post;
  },

  async update_post(ctx, args) {
    requireScope(ctx, "write");
    const id = String(args.id);
    const post = await ctx.adapter.posts.update(id, {
      title: args.title as string | undefined,
      bodyMdx: args.body_mdx as string | undefined,
      excerpt: args.excerpt as string | undefined,
      tldr: args.tldr as string | undefined,
      coverImageUrl: args.cover_image_url as string | undefined,
      templateId: args.template_id as string | undefined,
      canonicalUrl: args.canonical_url as string | undefined,
      customMetaTitle: args.custom_meta_title as string | undefined,
      customMetaDescription: args.custom_meta_description as string | undefined,
      noindex: args.noindex as boolean | undefined,
      isCornerstone: args.is_cornerstone as boolean | undefined,
    });
    await audit(ctx, "post.update", { id });
    return post;
  },

  async publish_post(ctx, args) {
    requireScope(ctx, "write");
    const id = String(args.id);
    const post = await ctx.adapter.posts.publish(id, {
      publishedAt: args.published_at as string | undefined,
    });
    await audit(ctx, "post.publish", { id, slug: post.slug });
    return post;
  },

  async schedule_post(ctx, args) {
    requireScope(ctx, "write");
    const id = String(args.id);
    const publishAt = String(args.publish_at);
    const post = await ctx.adapter.posts.schedule(id, publishAt);
    await audit(ctx, "post.schedule", { id, publishAt });
    return post;
  },

  async archive_post(ctx, args) {
    requireScope(ctx, "write");
    const id = String(args.id);
    const post = await ctx.adapter.posts.archive(id);
    await audit(ctx, "post.archive", { id });
    return post;
  },

  async list_tags(ctx) {
    return ctx.adapter.tags.list();
  },

  async list_categories(ctx) {
    return ctx.adapter.categories.list();
  },

  async list_authors(ctx) {
    return ctx.adapter.authors.list();
  },

  async list_templates(ctx) {
    return ctx.adapter.templates.list();
  },

  async get_template(ctx, args) {
    return ctx.adapter.templates.getById(String(args.id));
  },

  async list_revisions(ctx, args) {
    return ctx.adapter.revisions.listByPost(
      String(args.post_id),
      typeof args.limit === "number" ? args.limit : 25,
    );
  },

  async get_seo_report(ctx, args) {
    const post = args.post_id
      ? await ctx.adapter.posts.getById(String(args.post_id))
      : args.slug
      ? await ctx.adapter.posts.getBySlug(String(args.slug))
      : null;
    if (!post) return null;
    const [citations, template] = await Promise.all([
      ctx.adapter.citations.listByPost(post.id),
      ctx.adapter.templates.getById(post.templateId),
    ]);
    const site = ctx.scoringSite ?? (await defaultScoringSite(ctx));
    return buildVisibilityReport({
      post,
      citations,
      template: template ?? undefined,
      site,
    });
  },

  // v1.1 — headline scorer.
  async score_headlines(_ctx, args) {
    const variants = (args.variants as HeadlineVariant[]) ?? [];
    if (variants.length === 0) return { winner: null, ranking: [] };
    return pickWinner({
      variants,
      targetKeyword: args.target_keyword as string | undefined,
      requiredBrand: args.required_brand as string | undefined,
      bodyWordCount: args.body_word_count as number | undefined,
      bodyHasList: args.body_has_list as boolean | undefined,
    });
  },

  // v1.1 — topic-gap analyzer.
  async analyze_topic_gaps(ctx, args) {
    const posts = await ctx.adapter.posts.list({
      status: "published",
      limit: 5000,
    });
    const tagMap = new Map<string, string[]>();
    await Promise.all(
      posts.map(async (post) => {
        const tags = await ctx.adapter.posts.getTags(post.id);
        tagMap.set(
          post.id,
          tags.map((t) => t.slug),
        );
      }),
    );
    return analyzeTopicGaps({
      posts,
      postTags: tagMap,
      minClusterSize: typeof args.min_cluster_size === "number" ? args.min_cluster_size : 3,
    });
  },

  // v1.1 — alt-text suggestion.
  async suggest_alt_text(_ctx, args) {
    return suggestAltText({
      imageUrl: String(args.image_url),
      context: String(args.context ?? ""),
      maxChars: typeof args.max_chars === "number" ? args.max_chars : 125,
      // Vision model is optional and set by the framework adapter at
      // mount time. When absent, suggestAltText falls back to heuristics.
    });
  },

  // v1.1 — voice scorer (reads the active voice guide from settings).
  async score_voice(ctx, args) {
    const guide = ((await ctx.adapter.settings.get("public.voice_guide")) as VoiceGuide | null) ?? {
      banned: [],
      required: [],
      tone: [],
      minSentenceWords: 8,
      maxSentenceWords: 30,
    };
    return scoreVoice({
      bodyMdx: String(args.body_mdx),
      title: args.title as string | undefined,
      guide,
    });
  },

  // v1.1 — mention rollups (read-only — the polling worker writes results).
  async list_mention_rollups(ctx, args) {
    const queries = await ctx.adapter.settings.get<Array<{ id: string; query: string }>>("admin.mention_queries");
    if (!queries || queries.length === 0) return [];
    const days = typeof args.days === "number" ? args.days : 7;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const results = await ctx.adapter.settings.get<
      Array<{
        queryId: string;
        provider: string;
        probedAt: string;
        wasCited: boolean;
        citedSlugs: string[];
        competitorDomains: string[];
        citationRank: number | null;
        excerpt: string;
        meta?: Record<string, unknown>;
      }>
    >("admin.mention_results");
    const byQuery = new Map<string, typeof results>();
    for (const r of results ?? []) {
      if (r.probedAt < since) continue;
      const list = byQuery.get(r.queryId) ?? [];
      list.push(r);
      byQuery.set(r.queryId, list);
    }
    const filteredQueries = args.query_id
      ? queries.filter((q) => q.id === args.query_id)
      : queries;
    return filteredQueries.map((query) =>
      summarizeMentions({
        query,
        results: (byQuery.get(query.id) ?? []) as any,
      }),
    );
  },

  // v1.5 — agent-driven tool/template authoring (PRD §19.2).
  ...agentHandlers,
};

async function resolveTagIds(
  ctx: HandlerContext,
  slugs: readonly string[],
): Promise<string[]> {
  const out: string[] = [];
  for (const slug of slugs) {
    const existing = await ctx.adapter.tags.getBySlug(slug);
    if (existing) {
      out.push(existing.id);
    } else {
      const created = await ctx.adapter.tags.create({
        name: titleCase(slug),
        slug,
      });
      out.push(created.id);
    }
  }
  return out;
}

async function defaultScoringSite(ctx: HandlerContext): Promise<ScoreSiteState> {
  const site = ((await ctx.adapter.settings.get("public.site")) as SiteConfig | null) ?? {
    name: "BlogKit Site",
    url: "https://example.com",
  };
  const organization = ((await ctx.adapter.settings.get("public.organization")) as
    | { name: string; logoUrl?: string; sameAs: string[] }
    | null) ?? {
    name: site.name,
    sameAs: [],
  };
  return {
    site,
    organization,
    robotsAllowsAi: true,
    mcpEnabled: true,
    aiPluginManifest: true,
    serverSideRendered: true,
  };
}

async function audit(
  ctx: HandlerContext,
  action: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await ctx.adapter.audit.record({
    actorType: ctx.actorType,
    actorId: ctx.actorId,
    action,
    payload,
  });
}

function requireScope(ctx: HandlerContext, _required: "write" | "admin"): void {
  // The actual scope check happens in the transport (HTTP token auth). The
  // stdio transport runs as the local user; the audit row records the actor.
  void ctx;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function titleCase(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
