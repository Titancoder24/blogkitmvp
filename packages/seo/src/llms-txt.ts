/**
 * `/llms.txt` and `/llms-full.txt` generators (PRD §6.5).
 *
 * llms.txt format: a markdown file with the site title (`# Title`), a
 * short description paragraph, then headed sections of links. AI agents
 * fetch this once to understand what's worth crawling on a given site.
 *
 * llms-full.txt is the heavy variant: site header + the full markdown of
 * every published post, concatenated. Useful for agents that prefer one
 * fetch to many.
 *
 * Both files regenerate on every publish (PRD §5.3, §8.4).
 */
import type { Post, SiteConfig } from "@blogkit/core/types";
import { absoluteUrl } from "./util.js";

export interface LlmsTxtPostEntry {
  post: Pick<
    Post,
    | "slug"
    | "title"
    | "excerpt"
    | "tldr"
    | "publishedAt"
    | "lastRefreshedAt"
    | "templateId"
    | "isCornerstone"
  >;
  /** Optional human-readable category for grouping. */
  section?: string;
}

export interface BuildLlmsTxtOptions {
  site: SiteConfig;
  posts: readonly LlmsTxtPostEntry[];
  /** Truncate to this many entries after sorting. PRD default: 50. */
  maxLinks?: number;
  /** Optional `Optional:` section for less-critical links. */
  optionalLinks?: ReadonlyArray<{ title: string; url: string; note?: string }>;
}

/**
 * The standard llms.txt: title, description, ranked + grouped links.
 *
 * Ranking favors cornerstone posts, then recently refreshed, then recently
 * published. This mirrors the sitemap priority schedule (PRD §18.5).
 */
export function buildLlmsTxt(opts: BuildLlmsTxtOptions): string {
  const max = opts.maxLinks ?? 50;
  const ranked = [...opts.posts]
    .sort(rankComparator)
    .slice(0, max);

  const grouped = new Map<string, LlmsTxtPostEntry[]>();
  for (const entry of ranked) {
    const section = entry.section ?? defaultSectionFor(entry.post.templateId);
    const bucket = grouped.get(section);
    if (bucket) bucket.push(entry);
    else grouped.set(section, [entry]);
  }

  const lines: string[] = [];
  lines.push(`# ${opts.site.name}`);
  lines.push("");
  if (opts.site.tagline) {
    lines.push(`> ${opts.site.tagline}`);
    lines.push("");
  }
  lines.push(
    `${opts.site.name} publishes ${ranked.length} posts that are likely to be useful to AI agents and users researching topics covered on this site. Posts are grouped by content type below; cornerstone and recently refreshed posts appear first within each group.`,
  );
  lines.push("");

  for (const [section, entries] of grouped) {
    lines.push(`## ${section}`);
    lines.push("");
    for (const entry of entries) {
      const { post } = entry;
      const url = absoluteUrl(opts.site.url, `/blog/${post.slug}`);
      const description = post.tldr ?? post.excerpt ?? "";
      const cleanDescription = description.replace(/\s+/g, " ").trim();
      const suffix = cleanDescription ? `: ${cleanDescription}` : "";
      lines.push(`- [${post.title}](${url})${suffix}`);
    }
    lines.push("");
  }

  if (opts.optionalLinks && opts.optionalLinks.length > 0) {
    lines.push("## Optional");
    lines.push("");
    for (const link of opts.optionalLinks) {
      const note = link.note ? `: ${link.note}` : "";
      lines.push(`- [${link.title}](${link.url})${note}`);
    }
    lines.push("");
  }

  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

export interface BuildLlmsFullTxtOptions {
  site: SiteConfig;
  posts: ReadonlyArray<{
    post: Pick<
      Post,
      | "slug"
      | "title"
      | "bodyMdx"
      | "excerpt"
      | "tldr"
      | "publishedAt"
      | "lastRefreshedAt"
      | "templateId"
      | "isCornerstone"
    >;
  }>;
}

/**
 * llms-full.txt: site header + each post's full markdown body, separated
 * by horizontal rules. Posts are ordered by the same ranking used in
 * llms.txt so the highest-signal content appears first.
 */
export function buildLlmsFullTxt(opts: BuildLlmsFullTxtOptions): string {
  const ranked = [...opts.posts].sort((a, b) => rankComparator(a, b));
  const parts: string[] = [];
  parts.push(`# ${opts.site.name}`);
  if (opts.site.tagline) parts.push(`> ${opts.site.tagline}`);
  parts.push(
    "",
    "This document concatenates the full markdown source of every published post on this site, ranked by cornerstone status and recency. Use it as a single-fetch alternative to crawling each post URL individually.",
    "",
  );

  for (const entry of ranked) {
    const url = absoluteUrl(opts.site.url, `/blog/${entry.post.slug}`);
    parts.push("---");
    parts.push("");
    parts.push(`# ${entry.post.title}`);
    parts.push(`Source: ${url}`);
    if (entry.post.publishedAt) parts.push(`Published: ${entry.post.publishedAt}`);
    if (entry.post.lastRefreshedAt) parts.push(`Updated: ${entry.post.lastRefreshedAt}`);
    parts.push("");
    parts.push(entry.post.bodyMdx.trim());
    parts.push("");
  }

  return `${parts.join("\n").trim()}\n`;
}

// ---------- ranking ----------
type Rankable = {
  post: Pick<
    Post,
    "publishedAt" | "lastRefreshedAt" | "isCornerstone"
  >;
};

function rankComparator(a: Rankable, b: Rankable): number {
  // Cornerstone first.
  if (a.post.isCornerstone !== b.post.isCornerstone) {
    return a.post.isCornerstone ? -1 : 1;
  }
  // Then most recently refreshed (or published) first.
  const aTime = mostRecent(a.post.lastRefreshedAt, a.post.publishedAt);
  const bTime = mostRecent(b.post.lastRefreshedAt, b.post.publishedAt);
  return bTime - aTime;
}

function mostRecent(...values: Array<string | undefined>): number {
  let best = 0;
  for (const v of values) {
    if (!v) continue;
    const t = new Date(v).getTime();
    if (Number.isFinite(t) && t > best) best = t;
  }
  return best;
}

function defaultSectionFor(templateId: string): string {
  const map: Record<string, string> = {
    article: "Articles",
    listicle: "Lists",
    comparison: "Comparisons",
    review: "Reviews",
    glossary: "Glossary",
    "how-to": "How-To Guides",
    recipe: "Recipes",
    product: "Products",
    "faq-hub": "FAQ Hubs",
    news: "News",
    "case-study": "Case Studies",
    landing: "Landing Pages",
  };
  return map[templateId] ?? "Posts";
}
