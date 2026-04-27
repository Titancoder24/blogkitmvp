import { describe, expect, it } from "vitest";
import {
  attemptDelivery,
  prepareDeliveries,
  RETRY_BACKOFF_SECONDS,
  signWebhookPayload,
  verifyWebhookSignature,
  type Fetcher,
  type WebhookSubscription,
} from "../webhooks.js";

const NOW = () => new Date("2026-04-25T00:00:00Z");

function sub(overrides: Partial<WebhookSubscription> = {}): WebhookSubscription {
  return {
    id: "s1",
    name: "test",
    url: "https://hook.example/inbox",
    secretHash: "x",
    events: ["*"],
    isEnabled: true,
    ...overrides,
  };
}

describe("signWebhookPayload / verifyWebhookSignature", () => {
  it("round-trips an HMAC-SHA256 signature", async () => {
    const sig = await signWebhookPayload("super-secret", '{"hi":1}');
    expect(sig.startsWith("sha256=")).toBe(true);
    expect(await verifyWebhookSignature("super-secret", '{"hi":1}', sig)).toBe(true);
  });

  it("rejects a tampered body", async () => {
    const sig = await signWebhookPayload("super-secret", '{"hi":1}');
    expect(await verifyWebhookSignature("super-secret", '{"hi":2}', sig)).toBe(false);
  });

  it("rejects a wrong secret", async () => {
    const sig = await signWebhookPayload("a", "body");
    expect(await verifyWebhookSignature("b", "body", sig)).toBe(false);
  });
});

describe("prepareDeliveries", () => {
  it("matches subscriptions whose events list includes the event", () => {
    const subscriptions = [
      sub({ id: "all", events: ["*"] }),
      sub({ id: "publish", events: ["post.published"] }),
      sub({ id: "score", events: ["score.dropped"] }),
      sub({ id: "off", isEnabled: false, events: ["*"] }),
    ];
    const out = prepareDeliveries({
      subscriptions,
      event: "post.published",
      data: { id: "p1" },
      eventId: "evt_1",
      now: NOW,
    });
    expect(out.map((d) => d.subscriptionId).sort()).toEqual(["all", "publish"]);
    expect(out[0]?.payload.event).toBe("post.published");
    expect(out[0]?.idempotencyKey).toBe("evt_1");
  });
});

describe("attemptDelivery", () => {
  function fetcherWith(status: number, body = "ok"): Fetcher {
    return async () =>
      ({
        status,
        async text() {
          return body;
        },
      });
  }

  function makeDelivery(attempt = 0) {
    return {
      delivery: {
        id: "d1",
        subscriptionId: "s1",
        event: "post.published" as const,
        idempotencyKey: "evt_1",
        payload: { id: "evt_1", event: "post.published", emittedAt: "x", data: {} },
        status: "pending" as const,
        attempt,
        nextAttemptAt: null,
        lastResponseStatus: null,
        lastResponseBody: null,
        deliveredAt: null,
        createdAt: "2026-04-25T00:00:00Z",
      },
      subscription: sub(),
      secret: "abc",
    };
  }

  it("marks 2xx as delivered", async () => {
    const result = await attemptDelivery(makeDelivery(), {
      fetch: fetcherWith(204),
      now: NOW,
    });
    expect(result.ok).toBe(true);
    expect(result.status).toBe("delivered");
    expect(result.nextAttemptAt).toBeNull();
  });

  it("marks 4xx (except 429) as expired immediately", async () => {
    const result = await attemptDelivery(makeDelivery(), {
      fetch: fetcherWith(400, "bad"),
      now: NOW,
    });
    expect(result.status).toBe("expired");
    expect(result.responseStatus).toBe(400);
  });

  it("schedules the next attempt with exponential backoff on 5xx", async () => {
    const result = await attemptDelivery(makeDelivery(0), {
      fetch: fetcherWith(503),
      now: NOW,
    });
    expect(result.status).toBe("failed");
    expect(result.nextAttemptAt).toBeTruthy();
    const delay =
      new Date(result.nextAttemptAt!).getTime() - NOW().getTime();
    expect(delay).toBe(RETRY_BACKOFF_SECONDS[0]! * 1000);
  });

  it("retries 429 with backoff (rate-limit, transient)", async () => {
    const result = await attemptDelivery(makeDelivery(0), {
      fetch: fetcherWith(429),
      now: NOW,
    });
    expect(result.status).toBe("failed");
    expect(result.nextAttemptAt).toBeTruthy();
  });

  it("expires after MAX_ATTEMPTS attempts on persistent 5xx", async () => {
    const result = await attemptDelivery(makeDelivery(RETRY_BACKOFF_SECONDS.length - 1), {
      fetch: fetcherWith(500),
      now: NOW,
    });
    expect(result.status).toBe("expired");
  });
});
