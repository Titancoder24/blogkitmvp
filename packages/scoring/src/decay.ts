/**
 * Decay / freshness analysis (PRD §18).
 *
 * AI engines deprioritize content older than ~90 days without freshness
 * signals; citation share drops sharply at the 13-week mark. The decay
 * dashboard surfaces this through three buckets, a per-post decay-risk
 * score, and concrete refresh suggestions.
 *
 * Everything here is pure-function over a list of posts. A scheduled job
 * in the admin app calls `freshnessSnapshot(posts, now)` weekly and
 * persists the result for the dashboard.
 */
import type { Post } from "@blogkit/core/types";

export type FreshnessBucket = "healthy" | "stable" | "decay-risk";

export interface FreshnessThresholds {
  /** Posts ≤ this many days old are healthy. */
  healthyDays: number;
  /** Posts ≤ this many days old are stable. */
  stableDays: number;
}

export const DEFAULT_THRESHOLDS: FreshnessThresholds = {
  healthyDays: 14,
  stableDays: 60,
};

export interface PostFreshness {
  postId: string;
  slug: string;
  title: string;
  bucket: FreshnessBucket;
  /** 0–100. Higher = more decay risk. */
  decayRisk: number;
  /** Days since the most recent refresh / publish. */
  ageDays: number;
  /** Effective freshness timestamp used to compute age. */
  freshnessTimestamp: string | null;
  /** True if the post is pinned at full priority (PRD §18.5). */
  isCornerstone: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Per-post freshness snapshot.
 *
 * `decayRisk` blends age and cornerstone status so the dashboard can
 * sort the worst offenders to the top: a 200-day-old non-cornerstone
 * post lands above a 200-day-old cornerstone post.
 */
export function freshnessFor(
  post: Post,
  now: Date = new Date(),
  thresholds: FreshnessThresholds = DEFAULT_THRESHOLDS,
): PostFreshness {
  const ts = post.lastRefreshedAt ?? post.publishedAt ?? post.updatedAt ?? null;
  const ageDays = ts ? (now.getTime() - new Date(ts).getTime()) / DAY_MS : Infinity;
  const bucket = ageDays <= thresholds.healthyDays
    ? "healthy"
    : ageDays <= thresholds.stableDays
    ? "stable"
    : "decay-risk";

  // 0 at age 0, 100 at 365 days, asymptote at 100. Cornerstone halves
  // the score because cornerstone posts are pinned at sitemap 1.0
  // regardless of age.
  let risk = clamp01(Math.log10(Math.max(1, ageDays)) / Math.log10(365)) * 100;
  if (post.isCornerstone) risk *= 0.5;

  return {
    postId: post.id,
    slug: post.slug,
    title: post.title,
    bucket,
    decayRisk: Math.round(risk),
    ageDays: Number.isFinite(ageDays) ? Math.round(ageDays) : -1,
    freshnessTimestamp: ts,
    isCornerstone: post.isCornerstone,
  };
}

export interface FreshnessSnapshot {
  generatedAt: string;
  total: number;
  buckets: Record<FreshnessBucket, PostFreshness[]>;
  /** Decay-risk-sorted top offenders for the dashboard's "Action queue". */
  topRisks: PostFreshness[];
}

export function freshnessSnapshot(
  posts: readonly Post[],
  opts: { now?: Date; thresholds?: FreshnessThresholds; topRisks?: number } = {},
): FreshnessSnapshot {
  const now = opts.now ?? new Date();
  const thresholds = opts.thresholds ?? DEFAULT_THRESHOLDS;
  const topN = opts.topRisks ?? 10;

  const buckets: Record<FreshnessBucket, PostFreshness[]> = {
    healthy: [],
    stable: [],
    "decay-risk": [],
  };

  const all: PostFreshness[] = [];
  for (const post of posts) {
    if (post.status !== "published") continue;
    const f = freshnessFor(post, now, thresholds);
    buckets[f.bucket].push(f);
    all.push(f);
  }

  const topRisks = [...all]
    .filter((f) => !f.isCornerstone || f.bucket === "decay-risk")
    .sort((a, b) => b.decayRisk - a.decayRisk)
    .slice(0, topN);

  return {
    generatedAt: now.toISOString(),
    total: all.length,
    buckets,
    topRisks,
  };
}

// ---------- refresh suggestions ----------
export interface RefreshSuggestion {
  postId: string;
  /** Stable id so duplicate suggestions can be deduped across runs. */
  ruleId: string;
  message: string;
  /** Lower is more urgent (1 = ship a fix today). */
  priority: 1 | 2 | 3;
}

/**
 * Static rule engine. The scheduled job in the admin app runs this
 * weekly per post and surfaces unique suggestions in the dashboard.
 *
 * Rules are intentionally simple — they encode editorial heuristics
 * without trying to be smart about content. The dashboard's job is to
 * point a human at posts that need attention, not to auto-edit them.
 */
export function suggestRefreshes(
  post: Post,
  opts: { now?: Date; bodyText?: string } = {},
): RefreshSuggestion[] {
  if (post.status !== "published") return [];
  const now = opts.now ?? new Date();
  const out: RefreshSuggestion[] = [];

  const fresh = freshnessFor(post, now);

  if (fresh.bucket === "decay-risk") {
    out.push({
      postId: post.id,
      ruleId: "decay.over-60-days",
      message: `Post hasn't been refreshed in ${fresh.ageDays} days. Update statistics, examples, and citations.`,
      priority: 1,
    });
  }

  if (fresh.ageDays > 30 && (post.citationCount ?? 0) === 0) {
    out.push({
      postId: post.id,
      ruleId: "citations.missing",
      message:
        "No citations on a 30+ day old post. AI engines weight citations heavily — add 3+ before the next refresh.",
      priority: 1,
    });
  }

  if (post.aiVisibilityScore !== undefined && post.aiVisibilityScore < 70) {
    out.push({
      postId: post.id,
      ruleId: "score.below-publish-threshold",
      message: `AI Visibility Score is ${Math.round(post.aiVisibilityScore)}. Open the editor to see the fix list.`,
      priority: 2,
    });
  }

  const wordCount = post.wordCount ?? approxWordCount(opts.bodyText ?? post.bodyMdx);
  if (wordCount < 300 && fresh.ageDays > 14) {
    out.push({
      postId: post.id,
      ruleId: "thin-content",
      message: `Post is only ${wordCount} words. Long-form (600+) ranks materially better; expand at next refresh.`,
      priority: 3,
    });
  }

  if ((post.faqJson?.length ?? 0) === 0 && fresh.ageDays > 14) {
    out.push({
      postId: post.id,
      ruleId: "faq.missing",
      message:
        "No FAQ block. AI Overviews and ChatGPT cite FAQ-structured content disproportionately — add 3+ Q/A pairs.",
      priority: 2,
    });
  }

  return out;
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function approxWordCount(text: string): number {
  return (text.match(/[A-Za-z0-9'’-]+/g) ?? []).length;
}
