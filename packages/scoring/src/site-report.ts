/**
 * Site-wide AI Visibility report (PRD §5B.6).
 *
 * Powers `/admin/visibility` — the editorial team's daily home view.
 * Aggregates per-post `aiVisibilityScore` and per-discipline scores
 * across the corpus into:
 *
 *   - median + mean per discipline
 *   - top 10 + bottom 10 by aggregate
 *   - distribution buckets (excellent / good / fair / poor)
 *   - decay-flagged posts (recently dropped by ≥ 10 points)
 *   - by-template breakdown so a team can see "we're great at Articles
 *     but our Glossaries are scoring poorly"
 *
 * Pure-function so the dashboard can show pre-computed snapshots
 * (cheap) and recompute on demand for any subset of posts.
 */
import type {
  AiVisibilityReport,
  Post,
  ScoreDiscipline,
  TemplateId,
} from "@blogkit/core/types";

export interface PostReportSummary {
  postId: string;
  slug: string;
  title: string;
  templateId: TemplateId;
  aggregate: number;
  scores: Record<ScoreDiscipline, number>;
  /** Aggregate at the previous snapshot, if known. */
  previousAggregate?: number;
}

export interface SiteVisibilityReport {
  generatedAt: string;
  totalPosts: number;
  /** Posts that have a computed `aiVisibilityScore`. */
  scoredPosts: number;
  median: ReportStats;
  mean: ReportStats;
  distribution: ScoreDistribution;
  topPosts: PostReportSummary[];
  bottomPosts: PostReportSummary[];
  /** Posts whose aggregate dropped by ≥ 10 points since last snapshot. */
  declined: Array<PostReportSummary & { delta: number }>;
  byTemplate: Record<string, TemplateReportRow>;
}

export interface ReportStats {
  aggregate: number;
  scores: Record<ScoreDiscipline, number>;
}

export interface ScoreDistribution {
  excellent: number; // ≥ 90
  good: number; // 70–89
  fair: number; // 50–69
  poor: number; // < 50
}

export interface TemplateReportRow {
  templateId: TemplateId;
  count: number;
  medianAggregate: number;
  /** Median of each discipline within this template. */
  medianScores: Record<ScoreDiscipline, number>;
}

export interface BuildSiteReportInput {
  posts: readonly Post[];
  /**
   * Optional precomputed reports. When provided, scores come from these
   * rather than from `post.aiVisibilityScore`, allowing fresh aggregates
   * without a full DB roundtrip.
   */
  reports?: ReadonlyMap<string, AiVisibilityReport>;
  /** Map of postId → previous aggregate for decline detection. */
  previousAggregates?: ReadonlyMap<string, number>;
  topN?: number;
  bottomN?: number;
  declineThreshold?: number;
}

const DISCIPLINES: readonly ScoreDiscipline[] = [
  "seo",
  "aeo",
  "geo",
  "aio",
  "llmo",
  "agentSeo",
];

export function buildSiteVisibilityReport(
  input: BuildSiteReportInput,
): SiteVisibilityReport {
  const topN = input.topN ?? 10;
  const bottomN = input.bottomN ?? 10;
  const declineThreshold = input.declineThreshold ?? 10;

  const summaries: PostReportSummary[] = [];
  for (const post of input.posts) {
    if (post.status !== "published") continue;
    const summary = summarize(post, input.reports?.get(post.id), input.previousAggregates);
    if (summary) summaries.push(summary);
  }

  const aggregates = summaries.map((s) => s.aggregate);
  const median: ReportStats = {
    aggregate: percentile(aggregates, 0.5),
    scores: medianPerDiscipline(summaries),
  };
  const mean: ReportStats = {
    aggregate: average(aggregates),
    scores: meanPerDiscipline(summaries),
  };

  const distribution = bucket(summaries.map((s) => s.aggregate));

  const sorted = [...summaries].sort((a, b) => b.aggregate - a.aggregate);
  const topPosts = sorted.slice(0, topN);
  const bottomPosts = sorted.slice(-bottomN).reverse();

  const declined: Array<PostReportSummary & { delta: number }> = [];
  for (const summary of summaries) {
    if (summary.previousAggregate === undefined) continue;
    const delta = summary.previousAggregate - summary.aggregate;
    if (delta >= declineThreshold) declined.push({ ...summary, delta });
  }
  declined.sort((a, b) => b.delta - a.delta);

  const byTemplate: Record<string, TemplateReportRow> = {};
  const grouped = groupByTemplate(summaries);
  for (const [templateId, items] of grouped) {
    byTemplate[templateId] = {
      templateId,
      count: items.length,
      medianAggregate: percentile(items.map((s) => s.aggregate), 0.5),
      medianScores: medianPerDiscipline(items),
    };
  }

  return {
    generatedAt: new Date().toISOString(),
    totalPosts: input.posts.length,
    scoredPosts: summaries.length,
    median,
    mean,
    distribution,
    topPosts,
    bottomPosts,
    declined,
    byTemplate,
  };
}

function summarize(
  post: Post,
  report: AiVisibilityReport | undefined,
  previous: ReadonlyMap<string, number> | undefined,
): PostReportSummary | null {
  const scores: Record<ScoreDiscipline, number> = report
    ? Object.fromEntries(
        DISCIPLINES.map((d) => [d, report.scores[d]?.score ?? 0] as const),
      ) as Record<ScoreDiscipline, number>
    : zeroScores();
  const aggregate = report?.aggregate ?? post.aiVisibilityScore ?? null;
  if (aggregate === null) return null;
  return {
    postId: post.id,
    slug: post.slug,
    title: post.title,
    templateId: post.templateId,
    aggregate: Math.round(aggregate),
    scores,
    previousAggregate: previous?.get(post.id),
  };
}

function zeroScores(): Record<ScoreDiscipline, number> {
  return {
    seo: 0,
    aeo: 0,
    geo: 0,
    aio: 0,
    llmo: 0,
    agentSeo: 0,
  };
}

function bucket(values: readonly number[]): ScoreDistribution {
  const out: ScoreDistribution = { excellent: 0, good: 0, fair: 0, poor: 0 };
  for (const v of values) {
    if (v >= 90) out.excellent += 1;
    else if (v >= 70) out.good += 1;
    else if (v >= 50) out.fair += 1;
    else out.poor += 1;
  }
  return out;
}

function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
  return Math.round(sorted[idx] ?? 0);
}

function average(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const total = values.reduce((sum, v) => sum + v, 0);
  return Math.round(total / values.length);
}

function medianPerDiscipline(
  summaries: readonly PostReportSummary[],
): Record<ScoreDiscipline, number> {
  const out = zeroScores();
  for (const d of DISCIPLINES) {
    out[d] = percentile(summaries.map((s) => s.scores[d] ?? 0), 0.5);
  }
  return out;
}

function meanPerDiscipline(
  summaries: readonly PostReportSummary[],
): Record<ScoreDiscipline, number> {
  const out = zeroScores();
  for (const d of DISCIPLINES) {
    out[d] = average(summaries.map((s) => s.scores[d] ?? 0));
  }
  return out;
}

function groupByTemplate(
  summaries: readonly PostReportSummary[],
): Map<string, PostReportSummary[]> {
  const groups = new Map<string, PostReportSummary[]>();
  for (const s of summaries) {
    const key = String(s.templateId);
    const list = groups.get(key);
    if (list) list.push(s);
    else groups.set(key, [s]);
  }
  return groups;
}
