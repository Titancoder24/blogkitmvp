/**
 * `@blogkit/scoring` — the AI Visibility Score engine.
 *
 * Pure functions, no I/O. Consumers (the editor, the publish gate, the
 * MCP `get_seo_report` tool, the doctor command, the site-wide
 * /admin/visibility dashboard) all share this package so a 92 in one
 * place means the same thing as a 92 in any other.
 */
export {
  buildVisibilityReport,
  scoreAll,
  weightedGeoMean,
  resolveWeights,
  DEFAULT_WEIGHTS,
} from "./aggregate.js";
export { scoreSeo } from "./seo.js";
export { scoreAeo } from "./aeo.js";
export { scoreGeo } from "./geo.js";
export { scoreAio } from "./aio.js";
export { scoreLlmo } from "./llmo.js";
export { scoreAgentSeo } from "./agent-seo.js";
export type { ScoreContext, ScoreSiteState } from "./context.js";
export {
  analyzeBody,
  countWords,
  estimateReadingTimeMinutes,
  extractHeadings,
  isQuestionHeading,
  looksLikeDefinitionLead,
  titleImpliesListicle,
} from "./text.js";
export type { BodyAnalysis, Heading, LinkCounts } from "./text.js";

// Editorial intelligence — Definition-Lead, decay, link graph, site
// reports, view-as extractors. Pure functions, no I/O, framework-free.
export {
  evaluateDefinitionLead,
  definitionLeadPlaceholder,
  suggestDefinitionLead,
} from "./definition-lead.js";
export type {
  DefinitionLeadResult,
  DefinitionLeadFailureReason,
} from "./definition-lead.js";

export {
  freshnessFor,
  freshnessSnapshot,
  suggestRefreshes,
  DEFAULT_THRESHOLDS,
} from "./decay.js";
export type {
  FreshnessBucket,
  FreshnessThresholds,
  FreshnessSnapshot,
  PostFreshness,
  RefreshSuggestion,
} from "./decay.js";

export { buildLinkGraph, suggestInternalLinks } from "./link-graph.js";
export type {
  LinkGraph,
  LinkGraphEdge,
  LinkGraphNode,
  LinkSuggestion,
  SuggestLinksInput,
} from "./link-graph.js";

export { buildSiteVisibilityReport } from "./site-report.js";
export type {
  SiteVisibilityReport,
  PostReportSummary,
  ScoreDistribution,
  TemplateReportRow,
} from "./site-report.js";

export { extractForChatGpt, extractForGooglebot } from "./view-as.js";
export type {
  CrawlerExtraction,
  CrawlerIssue,
  ExtractedCitation,
  ImageAuditEntry,
  LlmExtraction,
  LlmSection,
  SocialPreview,
  Statistic,
} from "./view-as.js";
