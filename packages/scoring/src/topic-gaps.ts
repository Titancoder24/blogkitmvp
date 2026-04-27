/**
 * Topic-gap analyzer.
 *
 * Surfaces under-covered themes in the corpus by clustering posts on
 * tag co-occurrence and TF-IDF token overlap, then ranking each cluster
 * by relative coverage. The dashboard turns this into "you have 12 React
 * posts but only 1 about Server Components — that's a content gap."
 *
 * Embeddings-free on purpose: the team's tag taxonomy plus token co-
 * occurrence give a cheap, deterministic signal that runs in the same
 * pure-function shape as the rest of @blogkit/scoring.
 */
import type { Post } from "@blogkit/core/types";

export interface TopicCluster {
  /** Cluster id — derived from the dominant token + dominant tag. */
  id: string;
  /** Human-readable label ("React", "Performance & Core Web Vitals"). */
  label: string;
  /** Post ids that fall into this cluster. */
  postIds: string[];
  /** Tag slugs used to identify the cluster. */
  tagSlugs: string[];
  /** Relative coverage in [0, 1] across the corpus. */
  coverage: number;
  /** Distinct sub-topics inside the cluster that have ≤ 1 post. */
  gaps: TopicGap[];
}

export interface TopicGap {
  /** Suggested sub-topic name. */
  topic: string;
  /** Reason the analyzer flagged it ("only 1 post", "no recent post", …). */
  reason: string;
  /** Suggested template for the new post. */
  suggestedTemplate: string;
  /** Score in [0, 1]; higher = bigger gap relative to cluster size. */
  priority: number;
}

export interface AnalyzeGapsInput {
  posts: readonly Post[];
  /** Per-post tag slugs. */
  postTags: ReadonlyMap<string, readonly string[]>;
  /** Skip clusters smaller than this. Default 3. */
  minClusterSize?: number;
}

export interface TopicGapsReport {
  generatedAt: string;
  clusters: TopicCluster[];
  /** Top gaps across all clusters, ordered by priority. */
  topGaps: Array<TopicGap & { clusterId: string }>;
}

export function analyzeTopicGaps(input: AnalyzeGapsInput): TopicGapsReport {
  const minClusterSize = input.minClusterSize ?? 3;
  const total = input.posts.length;
  const tagCount = countTags(input.postTags);
  const clustersByTag = clusterByTag(input.posts, input.postTags, minClusterSize);

  const clusters: TopicCluster[] = [];
  for (const cluster of clustersByTag) {
    const tokenCounts = countTokens(cluster.posts);
    const topTokens = topNTokens(tokenCounts, 12);
    const gaps = inferGaps(cluster, topTokens, input.postTags);
    clusters.push({
      id: cluster.id,
      label: cluster.label,
      postIds: cluster.posts.map((p) => p.id),
      tagSlugs: cluster.tagSlugs,
      coverage: total === 0 ? 0 : cluster.posts.length / total,
      gaps,
    });
  }

  clusters.sort((a, b) => b.postIds.length - a.postIds.length);

  const topGaps = clusters
    .flatMap((c) => c.gaps.map((g) => ({ ...g, clusterId: c.id })))
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 10);

  return {
    generatedAt: new Date().toISOString(),
    clusters,
    topGaps,
  };
  void tagCount;
}

// ---------- helpers ----------
interface RawCluster {
  id: string;
  label: string;
  tagSlugs: string[];
  posts: Post[];
}

function clusterByTag(
  posts: readonly Post[],
  postTags: ReadonlyMap<string, readonly string[]>,
  minSize: number,
): RawCluster[] {
  const byTag = new Map<string, Post[]>();
  for (const post of posts) {
    const tags = postTags.get(post.id) ?? [];
    for (const tag of tags) {
      const list = byTag.get(tag);
      if (list) list.push(post);
      else byTag.set(tag, [post]);
    }
  }

  const clusters: RawCluster[] = [];
  const assignedPosts = new Set<string>();
  // Largest tags first so the first cluster claims the dominant share.
  const orderedTags = [...byTag.entries()].sort(
    (a, b) => b[1].length - a[1].length,
  );
  for (const [tag, tagPosts] of orderedTags) {
    const fresh = tagPosts.filter((p) => !assignedPosts.has(p.id));
    if (fresh.length < minSize) continue;
    const id = `cluster.${tag}`;
    clusters.push({
      id,
      label: humanizeTag(tag),
      tagSlugs: [tag],
      posts: fresh,
    });
    for (const p of fresh) assignedPosts.add(p.id);
  }
  return clusters;
}

function humanizeTag(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "in", "on", "for", "to",
  "is", "are", "was", "were", "be", "by", "with", "from", "this", "that",
  "it", "as", "at", "we", "you", "they", "i", "your", "our", "their",
  "his", "her", "its", "have", "has", "had", "if", "so", "not", "do",
  "does", "did", "will", "would", "should", "could", "may", "might",
  "can", "what", "when", "where", "how", "why", "which", "who",
]);

function countTokens(posts: readonly Post[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const post of posts) {
    const tokens = (
      `${post.title} ${post.bodyMdx}`.toLowerCase().match(/[a-z][a-z0-9-]+/g) ??
      []
    ).filter((t) => t.length > 3 && !STOPWORDS.has(t));
    for (const token of new Set(tokens)) {
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
  }
  return counts;
}

function topNTokens(counts: Map<string, number>, n: number): string[] {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([token]) => token);
}

function countTags(
  postTags: ReadonlyMap<string, readonly string[]>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const list of postTags.values()) {
    for (const tag of list) out.set(tag, (out.get(tag) ?? 0) + 1);
  }
  return out;
}

function inferGaps(
  cluster: RawCluster,
  topTokens: readonly string[],
  postTags: ReadonlyMap<string, readonly string[]>,
): TopicGap[] {
  const out: TopicGap[] = [];

  // Tokens that appear in some but not most posts within the cluster
  // — those are likely sub-topics with shallow coverage.
  const tokenInPostCount = new Map<string, number>();
  for (const post of cluster.posts) {
    const tokens = new Set(
      (`${post.title} ${post.bodyMdx}`.toLowerCase().match(/[a-z][a-z0-9-]+/g) ?? [])
        .filter((t) => t.length > 3 && !STOPWORDS.has(t)),
    );
    for (const token of topTokens) {
      if (tokens.has(token)) {
        tokenInPostCount.set(token, (tokenInPostCount.get(token) ?? 0) + 1);
      }
    }
  }

  for (const token of topTokens) {
    const hits = tokenInPostCount.get(token) ?? 0;
    if (hits === 0) continue;
    if (hits / cluster.posts.length >= 0.5) continue;
    const priority = 1 - hits / cluster.posts.length;
    out.push({
      topic: humanizeTag(token),
      reason: `Only ${hits}/${cluster.posts.length} posts in this cluster mention "${token}".`,
      suggestedTemplate: pickTemplate(cluster.label, token),
      priority: Math.round(priority * 100) / 100,
    });
  }

  // Stale-cluster signal: if no post in the cluster has been refreshed
  // in the last 90 days, the whole cluster is at decay risk.
  const stale = cluster.posts.every((p) => isStale(p));
  if (stale) {
    out.push({
      topic: cluster.label,
      reason: "No post in this cluster has been refreshed in over 90 days.",
      suggestedTemplate: "article",
      priority: 0.9,
    });
  }

  out.sort((a, b) => b.priority - a.priority);
  return out.slice(0, 5);
  void postTags;
}

const DAY_MS = 24 * 60 * 60 * 1000;
function isStale(post: Post): boolean {
  const ts = post.lastRefreshedAt ?? post.publishedAt ?? post.updatedAt;
  if (!ts) return true;
  return (Date.now() - new Date(ts).getTime()) / DAY_MS > 90;
}

function pickTemplate(clusterLabel: string, token: string): string {
  const t = token.toLowerCase();
  if (t.includes("vs") || t.includes("versus")) return "comparison";
  if (t === "best" || t.startsWith("top")) return "listicle";
  if (t.endsWith("ing") || t.startsWith("how")) return "how-to";
  if (t.includes("review")) return "review";
  if (t.length <= 5) return "glossary";
  return "article";
  void clusterLabel;
}
