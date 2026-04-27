/**
 * `@blogkit/intelligence` — I/O-bound editorial intelligence.
 *
 * Modules in this package have side effects: probing LLM providers,
 * making HTTP requests, dispatching webhooks. The rest of BlogKit's
 * intelligence layer (scoring, link-graph, decay, view-as) is in
 * `@blogkit/scoring` and stays pure-function.
 */
export {
  probeMentions,
  summarizeMentions,
  createStubProber,
} from "./mentions.js";
export type {
  AiProvider,
  AiModelProber,
  ProbeResponse,
  ProbeMentionsInput,
  MentionQuery,
  MentionResult,
  MentionRollup,
  ProviderRollup,
  SummarizeMentionsInput,
} from "./mentions.js";

export {
  signWebhookPayload,
  verifyWebhookSignature,
  prepareDeliveries,
  attemptDelivery,
  RETRY_BACKOFF_SECONDS,
  MAX_ATTEMPTS,
} from "./webhooks.js";
export type {
  WebhookEvent,
  WebhookSubscription,
  WebhookDelivery,
  WebhookEnvelope,
  PreparedDelivery,
  DeliveryAttemptInput,
  DeliveryAttemptResult,
  AttemptOptions,
  Fetcher,
} from "./webhooks.js";

export {
  checkLink,
  checkLinksBatch,
  extractExternalLinks,
} from "./link-health.js";
export type {
  LinkHealth,
  LinkProbe,
  LinkFetcher,
  CheckLinkOptions,
  BatchOptions,
  ExtractedExternalLink,
} from "./link-health.js";
