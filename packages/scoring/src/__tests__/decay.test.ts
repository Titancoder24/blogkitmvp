import type { Post } from "@blogkit/core/types";
import { describe, expect, it } from "vitest";
import { freshnessFor, freshnessSnapshot, suggestRefreshes } from "../decay.js";

const NOW = new Date("2026-04-25T00:00:00Z");

function makePost(overrides: Partial<Post> = {}): Post {
  return {
    id: overrides.id ?? "p",
    slug: overrides.slug ?? "post",
    title: overrides.title ?? "Post",
    bodyMdx: overrides.bodyMdx ?? "Body.",
    status: overrides.status ?? "published",
    publishedAt: "2026-04-15T00:00:00Z",
    updatedAt: "2026-04-15T00:00:00Z",
    createdAt: "2026-04-15T00:00:00Z",
    schemaType: "BlogPosting",
    templateId: "article",
    templateOverflow: {},
    noindex: false,
    citationCount: 0,
    isCornerstone: false,
    ...overrides,
  } as Post;
}

describe("freshnessFor", () => {
  it("buckets a recent post as healthy", () => {
    const result = freshnessFor(
      makePost({ lastRefreshedAt: "2026-04-20T00:00:00Z" }),
      NOW,
    );
    expect(result.bucket).toBe("healthy");
    expect(result.ageDays).toBe(5);
  });

  it("buckets a 30-day-old post as stable", () => {
    const result = freshnessFor(
      makePost({ lastRefreshedAt: "2026-03-26T00:00:00Z" }),
      NOW,
    );
    expect(result.bucket).toBe("stable");
  });

  it("buckets a 200-day-old post as decay-risk", () => {
    const result = freshnessFor(
      makePost({ lastRefreshedAt: "2025-10-07T00:00:00Z" }),
      NOW,
    );
    expect(result.bucket).toBe("decay-risk");
    expect(result.decayRisk).toBeGreaterThan(50);
  });

  it("halves decay risk for cornerstone posts", () => {
    const ts = "2025-10-07T00:00:00Z";
    const regular = freshnessFor(makePost({ lastRefreshedAt: ts }), NOW);
    const cornerstone = freshnessFor(
      makePost({ lastRefreshedAt: ts, isCornerstone: true }),
      NOW,
    );
    expect(cornerstone.decayRisk).toBeLessThanOrEqual(regular.decayRisk / 2 + 1);
  });
});

describe("freshnessSnapshot", () => {
  it("groups posts into the three buckets and surfaces top risks", () => {
    const posts = [
      makePost({ id: "1", lastRefreshedAt: "2026-04-22T00:00:00Z" }),
      makePost({ id: "2", lastRefreshedAt: "2026-03-15T00:00:00Z" }),
      makePost({ id: "3", lastRefreshedAt: "2025-10-07T00:00:00Z" }),
      makePost({ id: "4", lastRefreshedAt: "2024-01-01T00:00:00Z" }),
    ];
    const snapshot = freshnessSnapshot(posts, { now: NOW });
    expect(snapshot.buckets.healthy).toHaveLength(1);
    expect(snapshot.buckets.stable).toHaveLength(1);
    expect(snapshot.buckets["decay-risk"]).toHaveLength(2);
    expect(snapshot.topRisks[0]?.postId).toBe("4");
  });

  it("ignores non-published posts", () => {
    const snapshot = freshnessSnapshot(
      [makePost({ id: "1", status: "draft" })],
      { now: NOW },
    );
    expect(snapshot.total).toBe(0);
  });
});

describe("suggestRefreshes", () => {
  it("flags decay-risk posts and missing-citation posts", () => {
    const post = makePost({
      lastRefreshedAt: "2025-10-07T00:00:00Z",
      citationCount: 0,
      faqJson: [],
      wordCount: 100,
    });
    const suggestions = suggestRefreshes(post, { now: NOW });
    const ids = suggestions.map((s) => s.ruleId);
    expect(ids).toContain("decay.over-60-days");
    expect(ids).toContain("citations.missing");
    expect(ids).toContain("faq.missing");
    expect(ids).toContain("thin-content");
  });

  it("returns nothing for fresh, well-cited posts", () => {
    const post = makePost({
      lastRefreshedAt: "2026-04-20T00:00:00Z",
      citationCount: 5,
      faqJson: [{ question: "Q", answer: "A" }],
      wordCount: 1200,
      aiVisibilityScore: 92,
    });
    expect(suggestRefreshes(post, { now: NOW })).toEqual([]);
  });

  it("ignores draft posts", () => {
    const post = makePost({ status: "draft" });
    expect(suggestRefreshes(post, { now: NOW })).toEqual([]);
  });
});
