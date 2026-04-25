/**
 * Internal link graph + orphan-post detection (PRD §6.9).
 *
 * Topical clusters are one of the strongest signals both Google and AI
 * engines use for retrieval. A post that no other post links to is an
 * orphan; it never appears via "related posts" and contributes nothing
 * to cluster authority. The dashboard surfaces orphans so they can be
 * fixed in the next refresh cycle.
 *
 * The graph also powers in-editor link suggestions: while a writer
 * works on post A, the editor proposes 3–5 high-affinity targets from
 * the corpus based on tag overlap and cosine similarity over a simple
 * TF-IDF index.
 */
import type { Post, Tag } from "@blogkit/core/types";
import { analyzeBody } from "./text.js";

export interface LinkGraphNode {
  id: string;
  slug: string;
  title: string;
  /** Number of internal links *out* of this post. */
  outDegree: number;
  /** Number of internal links *into* this post. */
  inDegree: number;
  isCornerstone: boolean;
}

export interface LinkGraphEdge {
  fromPostId: string;
  toPostId: string;
  /** Anchor text used in the link (best-effort extraction). */
  anchor?: string;
}

export interface LinkGraph {
  nodes: Map<string, LinkGraphNode>;
  edges: LinkGraphEdge[];
  /** Posts with zero inbound links. */
  orphans: LinkGraphNode[];
  /** Posts that link out to nothing — they leak topical authority. */
  deadEnds: LinkGraphNode[];
  /** Per-post cluster size: count of posts reachable in N hops. */
  hubScores: Map<string, number>;
}

export interface BuildLinkGraphInput {
  posts: readonly Post[];
  /** The site URL is used to recognize internal absolute URLs. */
  siteUrl: string;
  /** Routes prefix where posts live. Defaults to "/blog". */
  blogRoute?: string;
}

export function buildLinkGraph(input: BuildLinkGraphInput): LinkGraph {
  const blogRoute = input.blogRoute ?? "/blog";
  const slugIndex = new Map<string, Post>();
  for (const post of input.posts) {
    slugIndex.set(post.slug, post);
  }

  const nodes = new Map<string, LinkGraphNode>();
  for (const post of input.posts) {
    nodes.set(post.id, {
      id: post.id,
      slug: post.slug,
      title: post.title,
      outDegree: 0,
      inDegree: 0,
      isCornerstone: post.isCornerstone,
    });
  }

  const edges: LinkGraphEdge[] = [];
  for (const post of input.posts) {
    const links = extractLinks(post.bodyMdx);
    for (const link of links) {
      const targetSlug = resolveSlug(link.href, input.siteUrl, blogRoute);
      if (!targetSlug) continue;
      const target = slugIndex.get(targetSlug);
      if (!target || target.id === post.id) continue;
      edges.push({ fromPostId: post.id, toPostId: target.id, anchor: link.anchor });
      const fromNode = nodes.get(post.id);
      const toNode = nodes.get(target.id);
      if (fromNode) fromNode.outDegree += 1;
      if (toNode) toNode.inDegree += 1;
    }
  }

  const orphans: LinkGraphNode[] = [];
  const deadEnds: LinkGraphNode[] = [];
  for (const node of nodes.values()) {
    if (node.inDegree === 0) orphans.push(node);
    if (node.outDegree === 0) deadEnds.push(node);
  }
  orphans.sort((a, b) => Number(b.isCornerstone) - Number(a.isCornerstone));

  const hubScores = computeHubScores(nodes, edges);

  return { nodes, edges, orphans, deadEnds, hubScores };
}

interface ExtractedLink {
  href: string;
  anchor?: string;
}

const MARKDOWN_LINK_RE = /\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const HTML_LINK_RE = /<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

function extractLinks(body: string): ExtractedLink[] {
  // Strip code fences first so URLs inside `console.log("https://…")`
  // examples don't pollute the graph.
  const clean = analyzeBody(body).clean;
  const links: ExtractedLink[] = [];
  for (const m of clean.matchAll(MARKDOWN_LINK_RE)) {
    links.push({ href: m[2] ?? "", anchor: m[1] });
  }
  for (const m of body.matchAll(HTML_LINK_RE)) {
    const href = m[1] ?? "";
    const anchor = (m[2] ?? "").replace(/<[^>]+>/g, "").trim();
    links.push({ href, anchor: anchor || undefined });
  }
  return links;
}

function resolveSlug(href: string, siteUrl: string, blogRoute: string): string | null {
  if (!href) return null;
  let path = href;
  if (/^https?:\/\//i.test(href)) {
    try {
      const url = new URL(href);
      const siteHost = new URL(siteUrl).host.toLowerCase();
      if (url.host.toLowerCase() !== siteHost) return null;
      path = url.pathname;
    } catch {
      return null;
    }
  }
  const prefix = `${blogRoute.replace(/\/+$/, "")}/`;
  if (!path.startsWith(prefix)) return null;
  const slug = path.slice(prefix.length).split("/")[0]?.split("#")[0]?.split("?")[0];
  return slug && slug.length > 0 ? slug : null;
}

/**
 * Hub score: count of posts within 2 hops of each node. A post with
 * a high hub score sits at the center of a topical cluster. The dashboard
 * surfaces top hubs as "cornerstone candidates" — posts that should
 * probably be marked `isCornerstone`.
 */
function computeHubScores(
  nodes: Map<string, LinkGraphNode>,
  edges: readonly LinkGraphEdge[],
): Map<string, number> {
  const adjacency = new Map<string, Set<string>>();
  for (const node of nodes.keys()) adjacency.set(node, new Set());
  for (const edge of edges) {
    adjacency.get(edge.fromPostId)?.add(edge.toPostId);
    adjacency.get(edge.toPostId)?.add(edge.fromPostId);
  }
  const out = new Map<string, number>();
  for (const node of nodes.keys()) {
    const visited = new Set<string>([node]);
    const frontier1 = adjacency.get(node) ?? new Set();
    for (const n of frontier1) visited.add(n);
    for (const n of frontier1) {
      const next = adjacency.get(n) ?? new Set();
      for (const nn of next) visited.add(nn);
    }
    visited.delete(node);
    out.set(node, visited.size);
  }
  return out;
}

// ---------- TF-IDF link suggestions ----------
export interface LinkSuggestion {
  postId: string;
  slug: string;
  title: string;
  /** Score in [0, 1]. Higher = more relevant. */
  score: number;
  /** Tag-overlap component, exposed for "why we suggested this" copy. */
  tagOverlap: number;
}

export interface SuggestLinksInput {
  /** The post the writer is currently editing. */
  draft: Pick<Post, "id" | "title" | "bodyMdx">;
  draftTagSlugs?: readonly string[];
  /** Candidate corpus — typically all published posts. */
  corpus: readonly Post[];
  /** Lookup from post id → tag slugs (used for the tag-overlap term). */
  postTags?: ReadonlyMap<string, readonly string[]>;
  /** Cap on returned suggestions. Default 5. */
  limit?: number;
}

export function suggestInternalLinks(input: SuggestLinksInput): LinkSuggestion[] {
  const limit = input.limit ?? 5;
  const draftTokens = tokenize(`${input.draft.title} ${input.draft.bodyMdx}`);
  const draftSet = new Set(draftTokens);
  const draftTags = new Set(input.draftTagSlugs ?? []);

  const idf = computeIdf(input.corpus);

  const scored: LinkSuggestion[] = [];
  for (const post of input.corpus) {
    if (post.id === input.draft.id) continue;
    if (post.status !== "published") continue;

    const docTokens = new Set(tokenize(`${post.title} ${post.bodyMdx}`));
    let cos = 0;
    for (const token of draftSet) {
      if (!docTokens.has(token)) continue;
      const w = idf.get(token) ?? 0;
      cos += w * w;
    }

    const tags = input.postTags?.get(post.id) ?? [];
    const overlap = countOverlap(draftTags, tags);
    const tagBoost = overlap === 0 ? 0 : overlap / Math.max(draftTags.size, 1);

    const score = clamp01(0.6 * normalize(cos) + 0.4 * tagBoost);
    if (score === 0) continue;

    scored.push({
      postId: post.id,
      slug: post.slug,
      title: post.title,
      score,
      tagOverlap: overlap,
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "of",
  "in",
  "on",
  "for",
  "to",
  "is",
  "are",
  "was",
  "were",
  "be",
  "by",
  "with",
  "from",
  "this",
  "that",
  "it",
  "as",
  "at",
  "we",
  "you",
  "they",
  "i",
  "your",
  "our",
  "their",
  "his",
  "her",
  "its",
  "have",
  "has",
  "had",
  "if",
  "so",
  "not",
  "do",
  "does",
  "did",
]);

function tokenize(text: string): string[] {
  const matches = text.toLowerCase().match(/[a-z][a-z0-9-]+/g) ?? [];
  return matches.filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

function computeIdf(corpus: readonly Post[]): Map<string, number> {
  const docFreq = new Map<string, number>();
  for (const post of corpus) {
    const tokens = new Set(tokenize(`${post.title} ${post.bodyMdx}`));
    for (const token of tokens) {
      docFreq.set(token, (docFreq.get(token) ?? 0) + 1);
    }
  }
  const N = Math.max(1, corpus.length);
  const idf = new Map<string, number>();
  for (const [token, df] of docFreq) {
    idf.set(token, Math.log(1 + N / (1 + df)));
  }
  return idf;
}

function countOverlap(set: Set<string>, list: readonly string[]): number {
  let n = 0;
  for (const item of list) if (set.has(item)) n += 1;
  return n;
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function normalize(value: number): number {
  // Squash positive values into [0, 1] without an absolute upper bound:
  // a tiny match scores low, a very large match plateaus near 1.
  if (value <= 0) return 0;
  return 1 - 1 / (1 + value);
}

// Re-export Tag for the rare consumer that wants to type their tag map.
export type { Tag };
