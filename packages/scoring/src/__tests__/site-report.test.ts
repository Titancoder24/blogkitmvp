import type { Post } from "@blogkit/core/types";
import { describe, expect, it } from "vitest";
import { buildSiteVisibilityReport } from "../site-report.js";

function makePost(overrides: Partial<Post> = {}): Post {
  return {
    id: overrides.id ?? "p",
    slug: overrides.slug ?? "post",
    title: overrides.title ?? "Post",
    bodyMdx: "",
    status: overrides.status ?? "published",
    schemaType: "BlogPosting",
    templateId: overrides.templateId ?? "article",
    templateOverflow: {},
    noindex: false,
    citationCount: 0,
    isCornerstone: false,
    createdAt: "2026-04-01T00:00:00Z",
    updatedAt: "2026-04-01T00:00:00Z",
    aiVisibilityScore: overrides.aiVisibilityScore,
    ...overrides,
  } as Post;
}

describe("buildSiteVisibilityReport", () => {
  it("computes median, distribution, top, and bottom", () => {
    const posts = [
      makePost({ id: "1", slug: "a", aiVisibilityScore: 95 }),
      makePost({ id: "2", slug: "b", aiVisibilityScore: 80 }),
      makePost({ id: "3", slug: "c", aiVisibilityScore: 65 }),
      makePost({ id: "4", slug: "d", aiVisibilityScore: 40 }),
      makePost({ id: "5", slug: "e", aiVisibilityScore: 92 }),
    ];
    const report = buildSiteVisibilityReport({ posts });
    expect(report.scoredPosts).toBe(5);
    expect(report.median.aggregate).toBe(80);
    expect(report.distribution.excellent).toBe(2);
    expect(report.distribution.good).toBe(1);
    expect(report.distribution.fair).toBe(1);
    expect(report.distribution.poor).toBe(1);
    expect(report.topPosts[0]?.aggregate).toBe(95);
    expect(report.bottomPosts[0]?.aggregate).toBe(40);
  });

  it("groups by template", () => {
    const posts = [
      makePost({ id: "1", templateId: "article", aiVisibilityScore: 90 }),
      makePost({ id: "2", templateId: "article", aiVisibilityScore: 70 }),
      makePost({ id: "3", templateId: "glossary", aiVisibilityScore: 50 }),
    ];
    const report = buildSiteVisibilityReport({ posts });
    expect(report.byTemplate["article"]?.count).toBe(2);
    expect(report.byTemplate["article"]?.medianAggregate).toBe(70);
    expect(report.byTemplate["glossary"]?.count).toBe(1);
  });

  it("flags posts that declined ≥ threshold since the previous snapshot", () => {
    const posts = [
      makePost({ id: "1", slug: "a", aiVisibilityScore: 70 }),
      makePost({ id: "2", slug: "b", aiVisibilityScore: 80 }),
    ];
    const previous = new Map([
      ["1", 90],
      ["2", 82],
    ]);
    const report = buildSiteVisibilityReport({
      posts,
      previousAggregates: previous,
    });
    expect(report.declined).toHaveLength(1);
    expect(report.declined[0]?.postId).toBe("1");
    expect(report.declined[0]?.delta).toBe(20);
  });

  it("ignores draft and unscored posts", () => {
    const report = buildSiteVisibilityReport({
      posts: [
        makePost({ id: "1", status: "draft", aiVisibilityScore: 90 }),
        makePost({ id: "2", aiVisibilityScore: undefined }),
        makePost({ id: "3", aiVisibilityScore: 80 }),
      ],
    });
    expect(report.scoredPosts).toBe(1);
  });
});
