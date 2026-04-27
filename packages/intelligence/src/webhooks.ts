/**
 * Webhook event firehose.
 *
 * Every state transition that subscribers care about — `post.created`,
 * `post.published`, `post.archived`, `score.dropped`, `citation.added`,
 * `link.broken`, `mention.detected` — emits one webhook event.
 *
 * Design notes:
 *   - **Signed payloads.** Every delivery carries an `X-Blogkit-Signature`
 *     header: `sha256=<hex>`, computed as HMAC-SHA256 of the raw body
 *     using the subscription's secret. Subscribers verify this to rule
 *     out spoofed deliveries.
 *   - **Idempotency.** Each delivery has a stable idempotency key
 *     (`evt_<uuid>`); retries reuse the same key so subscribers can
 *     deduplicate.
 *   - **Retry policy.** Exponential backoff: 30s, 2m, 10m, 1h, 6h, 24h.
 *     After 6 failed attempts the delivery is marked `expired`.
 *   - **Pure-function delivery loop.** `deliverPending(loader, deliverer,
 *     now)` is testable end-to-end; the Supabase adapter implements
 *     `loader` and `deliverer` against the DB and `fetch`.
 */

export type WebhookEvent =
  | "post.created"
  | "post.updated"
  | "post.published"
  | "post.scheduled"
  | "post.archived"
  | "post.refreshed"
  | "score.dropped"
  | "score.improved"
  | "citation.added"
  | "citation.removed"
  | "link.broken"
  | "link.recovered"
  | "mention.detected"
  | "template.created"
  | "template.updated";

export interface WebhookSubscription {
  id: string;
  name: string;
  url: string;
  /** SHA-256 hash of the secret. The raw secret is never persisted. */
  secretHash: string;
  events: ReadonlyArray<WebhookEvent | "*">;
  isEnabled: boolean;
}

export interface WebhookDelivery {
  id: string;
  subscriptionId: string;
  event: WebhookEvent;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  status: "pending" | "delivered" | "failed" | "expired";
  attempt: number;
  nextAttemptAt: string | null;
  lastResponseStatus: number | null;
  lastResponseBody: string | null;
  deliveredAt: string | null;
  createdAt: string;
}

export const RETRY_BACKOFF_SECONDS: readonly number[] = [
  30,
  120,
  600,
  3600,
  21600,
  86400,
];

export const MAX_ATTEMPTS = RETRY_BACKOFF_SECONDS.length;

// ---------- signing ----------
/**
 * Compute the X-Blogkit-Signature header value for a payload + secret.
 * Uses SubtleCrypto so it works in both Node 18+ and edge runtimes.
 */
export async function signWebhookPayload(
  secret: string,
  body: string,
): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  return `sha256=${bufferToHex(sig)}`;
}

export async function verifyWebhookSignature(
  secret: string,
  body: string,
  header: string,
): Promise<boolean> {
  const expected = await signWebhookPayload(secret, body);
  return constantTimeEqual(expected, header);
}

function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= (a.charCodeAt(i) ^ b.charCodeAt(i)) | 0;
  }
  return mismatch === 0;
}

// ---------- emission ----------
export interface PreparedDelivery {
  subscriptionId: string;
  event: WebhookEvent;
  idempotencyKey: string;
  payload: WebhookEnvelope;
}

export interface WebhookEnvelope {
  /** Stable id of this event — same across retries of the same delivery. */
  id: string;
  event: WebhookEvent;
  /** ISO 8601 timestamp the event was emitted. */
  emittedAt: string;
  /** Free-form payload. Shape depends on the event. */
  data: Record<string, unknown>;
}

/**
 * Given a list of subscriptions and an event to emit, return one
 * `PreparedDelivery` per matching subscription. Pure function — the
 * adapter persists these as `pending` rows.
 */
export function prepareDeliveries(input: {
  subscriptions: readonly WebhookSubscription[];
  event: WebhookEvent;
  data: Record<string, unknown>;
  /** Override the event id (otherwise generated). */
  eventId?: string;
  now?: () => Date;
}): PreparedDelivery[] {
  const eventId = input.eventId ?? `evt_${randomUuid()}`;
  const emittedAt = (input.now ? input.now() : new Date()).toISOString();
  const envelope: WebhookEnvelope = {
    id: eventId,
    event: input.event,
    emittedAt,
    data: input.data,
  };

  const out: PreparedDelivery[] = [];
  for (const subscription of input.subscriptions) {
    if (!subscription.isEnabled) continue;
    if (
      !subscription.events.includes("*") &&
      !subscription.events.includes(input.event)
    ) {
      continue;
    }
    out.push({
      subscriptionId: subscription.id,
      event: input.event,
      idempotencyKey: eventId,
      payload: envelope,
    });
  }
  return out;
}

function randomUuid(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

// ---------- delivery loop ----------
export interface DeliveryAttemptInput {
  delivery: WebhookDelivery;
  subscription: WebhookSubscription;
  /** Raw secret (resolved from a key store; never stored alongside the hash). */
  secret: string;
}

export interface DeliveryAttemptResult {
  ok: boolean;
  responseStatus: number | null;
  responseBody: string | null;
  /** When non-null, the delivery should be retried at this time. */
  nextAttemptAt: string | null;
  status: WebhookDelivery["status"];
  attempt: number;
}

export type Fetcher = (
  url: string,
  init: { method: "POST"; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<{ status: number; text(): Promise<string> }>;

export interface AttemptOptions {
  fetch: Fetcher;
  now?: () => Date;
  /** Per-attempt timeout (ms). Defaults to 10s. */
  timeoutMs?: number;
}

/**
 * Attempt a single delivery. Returns the next state to persist. The
 * caller writes that state back to `blogkit_webhook_deliveries`.
 *
 * - 2xx → `delivered`.
 * - 5xx, network error, or timeout → `failed`, schedule retry per
 *   `RETRY_BACKOFF_SECONDS`, until `MAX_ATTEMPTS` exhausted →
 *   `expired`.
 * - 4xx (subscriber rejected the payload) → `expired` immediately;
 *   retrying client errors is wasted work.
 */
export async function attemptDelivery(
  input: DeliveryAttemptInput,
  opts: AttemptOptions,
): Promise<DeliveryAttemptResult> {
  const now = opts.now ? opts.now() : new Date();
  const body = JSON.stringify(input.delivery.payload);
  const signature = await signWebhookPayload(input.secret, body);
  const attempt = input.delivery.attempt + 1;

  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-blogkit-signature": signature,
    "x-blogkit-event": input.delivery.event,
    "x-blogkit-idempotency-key": input.delivery.idempotencyKey,
    "x-blogkit-attempt": String(attempt),
  };

  const controller =
    typeof AbortController !== "undefined" ? new AbortController() : null;
  const timeout = opts.timeoutMs ?? 10_000;
  const timer =
    controller && typeof setTimeout !== "undefined"
      ? setTimeout(() => controller.abort(), timeout)
      : null;

  let status: number | null = null;
  let text: string | null = null;
  let networkError = false;

  try {
    const response = await opts.fetch(input.subscription.url, {
      method: "POST",
      headers,
      body,
      signal: controller?.signal,
    });
    status = response.status;
    try {
      text = (await response.text()).slice(0, 4_000);
    } catch {
      text = null;
    }
  } catch (err) {
    networkError = true;
    text = err instanceof Error ? err.message : String(err);
  } finally {
    if (timer) clearTimeout(timer);
  }

  if (!networkError && status !== null && status >= 200 && status < 300) {
    return {
      ok: true,
      responseStatus: status,
      responseBody: text,
      nextAttemptAt: null,
      status: "delivered",
      attempt,
    };
  }

  // 4xx (except 429) → permanent failure.
  if (!networkError && status !== null && status >= 400 && status < 500 && status !== 429) {
    return {
      ok: false,
      responseStatus: status,
      responseBody: text,
      nextAttemptAt: null,
      status: "expired",
      attempt,
    };
  }

  if (attempt >= MAX_ATTEMPTS) {
    return {
      ok: false,
      responseStatus: status,
      responseBody: text,
      nextAttemptAt: null,
      status: "expired",
      attempt,
    };
  }

  const backoffSec = RETRY_BACKOFF_SECONDS[attempt - 1] ?? RETRY_BACKOFF_SECONDS[MAX_ATTEMPTS - 1] ?? 86_400;
  const next = new Date(now.getTime() + backoffSec * 1000);
  return {
    ok: false,
    responseStatus: status,
    responseBody: text,
    nextAttemptAt: next.toISOString(),
    status: "failed",
    attempt,
  };
}
