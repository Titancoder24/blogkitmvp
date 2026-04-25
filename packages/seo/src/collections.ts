/**
 * Auto-generated collection pages (PRD §5D.8).
 *
 * Templates that target a coherent content cluster get a /<slug> index
 * page that lists every post in the cluster. The SEO win: each cluster
 * earns its own `CollectionPage` JSON-LD entity, ItemList of contained
 * posts, and a stable URL that AI engines can cite when answering
 * cluster-level queries ("best static site generators", "recipe index",
 * "glossary of marketing terms", …).
 *
 * Routing:
 *   glossary   → /glossary
 *   review     → /reviews
 *   listicle   → /best       (the listicle hub — "best X" content)
 *   recipe     → /recipes
 *   how-to     → /how-to
 *   comparison → /comparisons
 *   case-study → /case-studies
 *   product    → /products
 *   faq-hub    → /faqs
 *   news       → /news
 *
 * The framework adapter wires the route; the data layer lives here so
 * Next.js, Remix, and Astro all consume the same shape.
 */
import type { Post, SiteConfig, TemplateId } from "@blogkit/core/types";
import { breadcrumbListJsonLd, type JsonLd } from "./jsonld.js";
import { absoluteUrl, isoDate } from "./util.js";

export interface CollectionDefinition {
  templateId: TemplateId;
  /** Path on the site (no trailing slash). */
  path: string;
  /** Human-readable name used in the H1 and JSON-LD. */
  title: string;
  description: string;
}

/**
 * Built-in collection-page mappings. The renderer can extend or override
 * via `customCollections` to surface community-template clusters.
 */
export const BUILT_IN_COLLECTIONS: readonly CollectionDefinition[] = [
  {
    templateId: "glossary",
    path: "/glossary",
    title: "Glossary",
    description: "Definitions for every term we use across this site.",
  },
  {
    templateId: "review",
    path: "/reviews",
    title: "Reviews",
    description: "In-depth reviews with explicit ratings, methodology, and verdicts.",
  },
  {
    templateId: "listicle",
    path: "/best",
    title: "Best of…",
    description: "Ranked and unranked lists across the topics we cover.",
  },
  {
    templateId: "recipe",
    path: "/recipes",
    title: "Recipes",
    description: "Step-by-step recipes with ingredients, timing, and nutrition.",
  },
  {
    templateId: "how-to",
    path: "/how-to",
    title: "How-To Guides",
    description: "Step-by-step guides with materials, time estimates, and troubleshooting.",
  },
  {
    templateId: "comparison",
    path: "/comparisons",
    title: "Comparisons",
    description: "Side-by-side comparisons with pros, cons, and explicit verdicts.",
  },
  {
    templateId: "case-study",
    path: "/case-studies",
    title: "Case Studies",
    description: "Long-form case studies with concrete metrics and timelines.",
  },
  {
    templateId: "product",
    path: "/products",
    title: "Products",
    description: "Product showcases with specs, gallery, and availability.",
  },
  {
    templateId: "faq-hub",
    path: "/faqs",
    title: "FAQs",
    description: "Topic-organized FAQ hubs.",
  },
  {
    templateId: "news",
    path: "/news",
    title: "News",
    description: "Time-sensitive news articles.",
  },
];

export interface BuildCollectionsInput {
  site: SiteConfig;
  posts: readonly Post[];
  /** Override or extend the built-in collection list. */
  customCollections?: readonly CollectionDefinition[];
  /**
   * Skip collections that have fewer than this many posts so empty
   * `/glossary` / `/recipes` indexes don't ship until there's content.
   */
  minPostsPerCollection?: number;
}

export interface CollectionPage {
  definition: CollectionDefinition;
  posts: Post[];
  /** Absolute URL of the collection index. */
  url: string;
  /** JSON-LD `CollectionPage` + `ItemList` + breadcrumbs. */
  jsonLd: JsonLd[];
}

export function buildCollectionPages(
  input: BuildCollectionsInput,
): CollectionPage[] {
  const definitions = input.customCollections ?? BUILT_IN_COLLECTIONS;
  const minPosts = input.minPostsPerCollection ?? 1;
  const out: CollectionPage[] = [];

  for (const definition of definitions) {
    const posts = input.posts
      .filter((p) => p.templateId === definition.templateId && p.status === "published")
      .sort(byCornerstoneThenRecency);
    if (posts.length < minPosts) continue;

    const url = absoluteUrl(input.site.url, definition.path);
    out.push({
      definition,
      posts,
      url,
      jsonLd: buildCollectionJsonLd(input.site, definition, posts, url),
    });
  }

  return out;
}

function buildCollectionJsonLd(
  site: SiteConfig,
  definition: CollectionDefinition,
  posts: readonly Post[],
  url: string,
): JsonLd[] {
  const collection: JsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "@id": `${url}#collection`,
    name: definition.title,
    description: definition.description,
    url,
    inLanguage: "en",
    isPartOf: { "@type": "WebSite", "@id": `${site.url.replace(/\/+$/, "")}#website` },
    mainEntity: {
      "@type": "ItemList",
      itemListElement: posts.map((post, idx) => ({
        "@type": "ListItem",
        position: idx + 1,
        url: absoluteUrl(site.url, `/blog/${post.slug}`),
        name: post.title,
        description: post.excerpt ?? post.tldr,
        datePublished: isoDate(post.publishedAt ?? post.createdAt),
      })),
      numberOfItems: posts.length,
    },
  };

  const breadcrumbs = breadcrumbListJsonLd(site.url, [
    { name: "Home", url: "/" },
    { name: definition.title, url: definition.path },
  ]);

  return [collection, breadcrumbs];
}

function byCornerstoneThenRecency(a: Post, b: Post): number {
  if (a.isCornerstone !== b.isCornerstone) return a.isCornerstone ? -1 : 1;
  const at = new Date(a.lastRefreshedAt ?? a.publishedAt ?? a.createdAt).getTime();
  const bt = new Date(b.lastRefreshedAt ?? b.publishedAt ?? b.createdAt).getTime();
  return bt - at;
}

/**
 * Sitemap entries for the auto-generated collection indexes. The next
 * adapter passes these to `buildSitemap` so the indexes ship with the
 * site map without manual configuration.
 */
export function collectionSitemapEntries(
  pages: readonly CollectionPage[],
): { url: string; lastmod?: string; changefreq?: "weekly" }[] {
  return pages.map((p) => ({
    url: p.definition.path,
    lastmod: p.posts[0]?.lastRefreshedAt ?? p.posts[0]?.publishedAt,
    changefreq: "weekly",
  }));
}
