/**
 * AI Mention Tracker.
 *
 * Periodically asks ChatGPT, Claude, Perplexity, Gemini, Copilot, and
 * Grok the queries the team cares about — and records whether the
 * brand's domain or specific posts get cited in the answer. The output
 * powers the dashboard's "AI Visibility — actually measured" view, the
 * single most-asked-for content-team metric in 2026.
 *
 * Design:
 *   - `AiModelProber` is a pluggable interface. The framework supplies
 *     concrete implementations (one per provider) via env config; the
 *     polling worker rotates through them.
 *   - The worker is pure-function: feed it queries, prober adapters,
 *     and the site domain set; it returns a list of `MentionResult`s
 *     to persist. The Supabase adapter writes them to
 *     `blogkit_mention_results`.
 *   - `summarizeMentions` aggregates results into the dashboard shape:
 *     mention rate per provider, share-of-voice vs. competitors, week-
 *     over-week deltas.
 */

export type AiProvider =
  | "chatgpt"
  | "claude"
  | "perplexity"
  | "gemini"
  | "copilot"
  | "grok";

export interface AiModelProber {
  provider: AiProvider;
  /**
   * Send `query` to the model and return the answer text plus any
   * citation URLs the model surfaced. The implementation handles the
   * provider-specific transport (Anthropic SDK, OpenAI SDK, Perplexity
   * API, etc.). All providers are expected to be configured for
   * "search" or "browse" tool use so they actually fetch sources.
   */
  probe(query: string): Promise<ProbeResponse>;
}

export interface ProbeResponse {
  /** The full answer text. */
  answer: string;
  /** URLs the model linked to or otherwise cited inline. */
  citationUrls: readonly string[];
  /** Provider-specific opaque metadata (model id, fan-out trace, etc.). */
  meta?: Record<string, unknown>;
}

export interface MentionQuery {
  id: string;
  query: string;
  /** Optional tag for grouping (e.g. "commercial", "informational"). */
  intent?: string;
}

export interface ProbeMentionsInput {
  query: MentionQuery;
  probers: readonly AiModelProber[];
  /** Hostnames the team owns — a citation for any of these counts as a "hit". */
  ownDomains: readonly string[];
  /** Map of slug → URL for posts under any of the owned domains. */
  postUrls?: ReadonlyMap<string, string>;
  /** Optional clock injection for tests. */
  now?: () => Date;
}

export interface MentionResult {
  queryId: string;
  provider: AiProvider;
  probedAt: string;
  wasCited: boolean;
  citedSlugs: string[];
  competitorDomains: string[];
  /** 1-indexed rank of the first own-domain citation, or null. */
  citationRank: number | null;
  /** Up to 4KB of the answer for dashboard preview. */
  excerpt: string;
  meta: Record<string, unknown>;
}

const EXCERPT_MAX = 4000;

export async function probeMentions(input: ProbeMentionsInput): Promise<MentionResult[]> {
  const probedAt = (input.now ? input.now() : new Date()).toISOString();
  const ownDomains = new Set(input.ownDomains.map(normalizeDomain));
  const out: MentionResult[] = [];

  for (const prober of input.probers) {
    let response: ProbeResponse;
    try {
      response = await prober.probe(input.query.query);
    } catch (err) {
      // A failed probe is its own row — the dashboard surfaces these so
      // a degrading provider is visible without poisoning the snapshot.
      out.push({
        queryId: input.query.id,
        provider: prober.provider,
        probedAt,
        wasCited: false,
        citedSlugs: [],
        competitorDomains: [],
        citationRank: null,
        excerpt: `__probe_error__: ${err instanceof Error ? err.message : String(err)}`,
        meta: { error: true },
      });
      continue;
    }

    const analysis = analyzeAnswer(response, ownDomains, input.postUrls);
    out.push({
      queryId: input.query.id,
      provider: prober.provider,
      probedAt,
      wasCited: analysis.wasCited,
      citedSlugs: analysis.citedSlugs,
      competitorDomains: analysis.competitorDomains,
      citationRank: analysis.citationRank,
      excerpt: response.answer.slice(0, EXCERPT_MAX),
      meta: response.meta ?? {},
    });
  }

  return out;
}

interface ProbeAnalysis {
  wasCited: boolean;
  citedSlugs: string[];
  competitorDomains: string[];
  citationRank: number | null;
}

function analyzeAnswer(
  response: ProbeResponse,
  ownDomains: ReadonlySet<string>,
  postUrls?: ReadonlyMap<string, string>,
): ProbeAnalysis {
  const cited: string[] = [];
  const competitors = new Set<string>();
  let firstOwnRank: number | null = null;

  // Build a slug→host index for the post-citation match.
  const slugByUrl = new Map<string, string>();
  if (postUrls) {
    for (const [slug, url] of postUrls) {
      slugByUrl.set(canonicalize(url), slug);
    }
  }

  // Inline URL extraction from the answer body — covers cases where the
  // provider returns text-only with linkified URLs but not a structured
  // citationUrls field.
  const inline = extractInlineUrls(response.answer);
  const allCitations = dedupe([...response.citationUrls, ...inline]);

  for (let i = 0; i < allCitations.length; i++) {
    const url = allCitations[i] ?? "";
    const host = hostOf(url);
    if (!host) continue;
    const isOwn = ownDomains.has(host);
    if (isOwn) {
      if (firstOwnRank === null) firstOwnRank = i + 1;
      const slug = slugByUrl.get(canonicalize(url));
      if (slug) cited.push(slug);
    } else {
      competitors.add(host);
    }
  }

  return {
    wasCited: firstOwnRank !== null,
    citedSlugs: dedupe(cited),
    competitorDomains: [...competitors].sort(),
    citationRank: firstOwnRank,
  };
}

function normalizeDomain(domain: string): string {
  return domain.replace(/^https?:\/\//i, "").replace(/^www\./, "").split("/")[0]?.toLowerCase() ?? "";
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function canonicalize(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    u.search = "";
    return `${u.host.replace(/^www\./, "")}${u.pathname.replace(/\/$/, "")}`.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

function extractInlineUrls(text: string): string[] {
  const urls = text.match(/https?:\/\/[^\s)<\]]+/g) ?? [];
  return urls.map((u) => u.replace(/[.,;:!?]+$/, ""));
}

function dedupe<T>(items: readonly T[]): T[] {
  return [...new Set(items)];
}

// ---------- aggregation for the dashboard ----------
export interface MentionRollup {
  queryId: string;
  query: string;
  /** Number of probes considered in the rollup. */
  totalProbes: number;
  /** Probes that resulted in a citation. */
  totalCitations: number;
  /** totalCitations / totalProbes, rounded to 1 decimal. */
  citationRate: number;
  /** Per-provider breakdown. */
  byProvider: Record<AiProvider, ProviderRollup>;
  /** Top competitors cited alongside (or instead of) us. */
  topCompetitors: Array<{ domain: string; mentions: number }>;
  /** Most-cited slugs in the period. */
  topSlugs: Array<{ slug: string; mentions: number }>;
  /** Citation rate from the previous period — drives WoW deltas. */
  previousCitationRate?: number;
}

export interface ProviderRollup {
  totalProbes: number;
  totalCitations: number;
  citationRate: number;
  averageRank: number | null;
}

export interface SummarizeMentionsInput {
  query: MentionQuery;
  results: readonly MentionResult[];
  /** Optional previous-period results for WoW comparison. */
  previousResults?: readonly MentionResult[];
}

export function summarizeMentions(input: SummarizeMentionsInput): MentionRollup {
  const total = input.results.length;
  const cited = input.results.filter((r) => r.wasCited);
  const citationRate = total === 0 ? 0 : Math.round((cited.length / total) * 1000) / 10;

  const byProvider: Record<AiProvider, ProviderRollup> = {
    chatgpt: emptyProvider(),
    claude: emptyProvider(),
    perplexity: emptyProvider(),
    gemini: emptyProvider(),
    copilot: emptyProvider(),
    grok: emptyProvider(),
  };

  const competitorCount = new Map<string, number>();
  const slugCount = new Map<string, number>();

  for (const result of input.results) {
    const bucket = byProvider[result.provider];
    if (!bucket) continue;
    bucket.totalProbes += 1;
    if (result.wasCited) bucket.totalCitations += 1;
    if (result.citationRank !== null) {
      bucket.averageRank = runningAverage(
        bucket.averageRank,
        result.citationRank,
        bucket.totalCitations,
      );
    }
    for (const domain of result.competitorDomains) {
      competitorCount.set(domain, (competitorCount.get(domain) ?? 0) + 1);
    }
    for (const slug of result.citedSlugs) {
      slugCount.set(slug, (slugCount.get(slug) ?? 0) + 1);
    }
  }

  for (const provider of Object.keys(byProvider) as AiProvider[]) {
    const bucket = byProvider[provider];
    bucket.citationRate =
      bucket.totalProbes === 0
        ? 0
        : Math.round((bucket.totalCitations / bucket.totalProbes) * 1000) / 10;
  }

  return {
    queryId: input.query.id,
    query: input.query.query,
    totalProbes: total,
    totalCitations: cited.length,
    citationRate,
    byProvider,
    topCompetitors: rankCounts(competitorCount, "domain", 10),
    topSlugs: rankCounts(slugCount, "slug", 10),
    previousCitationRate: input.previousResults
      ? citationRateOf(input.previousResults)
      : undefined,
  };
}

function emptyProvider(): ProviderRollup {
  return { totalProbes: 0, totalCitations: 0, citationRate: 0, averageRank: null };
}

function runningAverage(prev: number | null, value: number, n: number): number {
  if (prev === null || n <= 1) return value;
  return Math.round(((prev * (n - 1) + value) / n) * 100) / 100;
}

function citationRateOf(results: readonly MentionResult[]): number {
  if (results.length === 0) return 0;
  const cited = results.filter((r) => r.wasCited).length;
  return Math.round((cited / results.length) * 1000) / 10;
}

function rankCounts<K extends "domain" | "slug">(
  counts: Map<string, number>,
  key: K,
  topN: number,
): Array<K extends "domain" ? { domain: string; mentions: number } : { slug: string; mentions: number }> {
  const entries = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN);
  return entries.map(([k, mentions]) => {
    if (key === "domain") return { domain: k, mentions } as any;
    return { slug: k, mentions } as any;
  });
}

// ---------- stub provider ----------
/**
 * Stub prober for dev/tests. Returns a deterministic response derived
 * from the query, with no network I/O. Real providers are wired up by
 * the framework adapter using each LLM's SDK.
 */
export function createStubProber(provider: AiProvider): AiModelProber {
  return {
    provider,
    async probe(query: string): Promise<ProbeResponse> {
      return {
        answer: `[stub:${provider}] No answer available for "${query}".`,
        citationUrls: [],
        meta: { stub: true },
      };
    },
  };
}
