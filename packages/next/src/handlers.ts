/**
 * Web-standard `Request → Response` handlers used by the Next.js App
 * Router (route.ts files) and any other framework that speaks Web Fetch.
 *
 * The shape lets us share these handlers verbatim with the Remix and
 * Astro adapters — they all forward to the same `handleX(adapter, …)`
 * function. The Next-specific layer then becomes a thin file that just
 * re-exports the handler:
 *
 *   // app/sitemap.xml/route.ts
 *   import { sitemapHandler } from "@blogkit/next";
 *   import { adapter } from "@/lib/blogkit";
 *   export const GET = sitemapHandler(adapter, config);
 */
import type { ResolvedBlogKitConfig } from "@blogkit/core/types";
import {
  buildAiPluginManifest,
  buildAtomFeed,
  buildCollectionPages,
  buildLlmsFullTxt,
  buildLlmsTxt,
  buildRobotsTxt,
  buildRssFeed,
  buildSitemap,
  collectionSitemapEntries,
  type CollectionPage,
} from "@blogkit/seo";
import { createMcpHttpHandler } from "@blogkit/mcp";
import type { BlogKitAdapter } from "@blogkit/supabase/adapter";

export interface HandlerDependencies {
  adapter: BlogKitAdapter;
  config: ResolvedBlogKitConfig;
}

const FIVE_MINUTES = "public, max-age=0, s-maxage=300, stale-while-revalidate=600";

export function sitemapHandler({ adapter, config }: HandlerDependencies) {
  return async () => {
    const posts = await adapter.posts.list({
      status: "published",
      limit: 5000,
      orderBy: "published_at",
      orderDir: "desc",
    });
    // Auto-include collection pages (/glossary, /reviews, /best, …) so
    // they ship in the sitemap without manual configuration.
    const collections = buildCollectionPages({ site: config.site, posts });
    const xml = buildSitemap({
      siteUrl: config.site.url,
      entries: [
        { url: "/", changefreq: "daily", priority: 1.0 },
        { url: config.routes.blog, changefreq: "daily", priority: 0.9 },
        ...collectionSitemapEntries(collections),
        ...posts.map((post) => ({
          url: `${config.routes.blog}/${post.slug}`,
          lastmod: post.lastRefreshedAt ?? post.publishedAt ?? post.updatedAt,
          cornerstone: post.isCornerstone,
        })),
      ],
    });
    return new Response(xml, {
      headers: { "content-type": "application/xml; charset=utf-8", "cache-control": FIVE_MINUTES },
    });
  };
}

/**
 * `collectionPageData(adapter, config, path)` — server-loader for one of
 * the auto-generated collection routes. The page component reads this
 * and renders the index plus the JSON-LD stack.
 *
 * Usage in App Router:
 *   // app/glossary/page.tsx
 *   import { collectionPageData } from "@blogkit/next";
 *   export default async function GlossaryPage() {
 *     const data = await collectionPageData({ adapter, config }, "/glossary");
 *     if (!data) notFound();
 *     return <CollectionPageView data={data} />;
 *   }
 */
export async function collectionPageData(
  deps: HandlerDependencies,
  path: string,
): Promise<CollectionPage | null> {
  const { adapter, config } = deps;
  const posts = await adapter.posts.list({
    status: "published",
    limit: 5000,
    orderBy: "published_at",
    orderDir: "desc",
  });
  const pages = buildCollectionPages({ site: config.site, posts });
  return pages.find((p) => p.definition.path === path) ?? null;
}

export function rssHandler({ adapter, config }: HandlerDependencies) {
  return async () => {
    const posts = await adapter.posts.list({ status: "published", limit: 50 });
    const authorMap = await collectAuthors(adapter, posts);
    const xml = buildRssFeed({
      site: config.site,
      entries: posts.map((post) => ({
        post,
        author: post.authorId
          ? { name: authorMap.get(post.authorId)?.name ?? "" }
          : undefined,
      })),
    });
    return new Response(xml, {
      headers: { "content-type": "application/rss+xml; charset=utf-8", "cache-control": FIVE_MINUTES },
    });
  };
}

export function atomHandler({ adapter, config }: HandlerDependencies) {
  return async () => {
    const posts = await adapter.posts.list({ status: "published", limit: 50 });
    const authorMap = await collectAuthors(adapter, posts);
    const xml = buildAtomFeed({
      site: config.site,
      entries: posts.map((post) => ({
        post,
        author: post.authorId
          ? {
              name: authorMap.get(post.authorId)?.name ?? "",
              website: authorMap.get(post.authorId)?.website,
            }
          : undefined,
      })),
    });
    return new Response(xml, {
      headers: { "content-type": "application/atom+xml; charset=utf-8", "cache-control": FIVE_MINUTES },
    });
  };
}

export function llmsTxtHandler({ adapter, config }: HandlerDependencies) {
  return async () => {
    const posts = await adapter.posts.list({
      status: "published",
      limit: config.ai.llmsTxtMaxLinks,
    });
    const txt = buildLlmsTxt({
      site: config.site,
      maxLinks: config.ai.llmsTxtMaxLinks,
      posts: posts.map((post) => ({ post })),
    });
    return new Response(txt, {
      headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": FIVE_MINUTES },
    });
  };
}

export function llmsFullTxtHandler({ adapter, config }: HandlerDependencies) {
  return async () => {
    const posts = await adapter.posts.list({ status: "published", limit: 1000 });
    const txt = buildLlmsFullTxt({
      site: config.site,
      posts: posts.map((post) => ({ post })),
    });
    return new Response(txt, {
      headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": FIVE_MINUTES },
    });
  };
}

export function robotsTxtHandler({ config }: Omit<HandlerDependencies, "adapter">) {
  return async () => {
    const txt = buildRobotsTxt({
      siteUrl: config.site.url,
      allowedCrawlers: config.ai.allowedCrawlers,
      disallowPaths: [config.routes.admin, "/api/mcp"],
    });
    return new Response(txt, {
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": FIVE_MINUTES },
    });
  };
}

export function aiPluginManifestHandler({ config }: Omit<HandlerDependencies, "adapter">) {
  return async () => {
    const manifest = buildAiPluginManifest({
      site: config.site,
      organization: config.organization,
      mcpPath: config.mcp.enabled ? config.mcp.mountPath : null,
    });
    return new Response(JSON.stringify(manifest, null, 2), {
      headers: { "content-type": "application/json", "cache-control": FIVE_MINUTES },
    });
  };
}

export function mcpHandler({ adapter }: HandlerDependencies) {
  const handle = createMcpHttpHandler({ adapter });
  return async (request: Request) => handle(request);
}

async function collectAuthors(
  adapter: BlogKitAdapter,
  posts: ReadonlyArray<{ authorId?: string }>,
): Promise<Map<string, { name: string; website?: string }>> {
  const ids = Array.from(
    new Set(posts.map((p) => p.authorId).filter((id): id is string => Boolean(id))),
  );
  const out = new Map<string, { name: string; website?: string }>();
  await Promise.all(
    ids.map(async (id) => {
      const author = await adapter.authors.getById(id);
      if (author) out.set(id, { name: author.name, website: author.website });
    }),
  );
  return out;
}
