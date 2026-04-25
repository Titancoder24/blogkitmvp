import type { Post } from "@blogkit/core/types";
import { describe, expect, it } from "vitest";
import { buildLinkGraph, suggestInternalLinks } from "../link-graph.js";

function makePost(overrides: Partial<Post> = {}): Post {
  return {
    id: overrides.id ?? "p",
    slug: overrides.slug ?? "post",
    title: overrides.title ?? "Post",
    bodyMdx: overrides.bodyMdx ?? "",
    status: overrides.status ?? "published",
    schemaType: "BlogPosting",
    templateId: "article",
    templateOverflow: {},
    noindex: false,
    citationCount: 0,
    isCornerstone: false,
    createdAt: "2026-04-01T00:00:00Z",
    updatedAt: "2026-04-01T00:00:00Z",
    ...overrides,
  } as Post;
}

describe("buildLinkGraph", () => {
  it("counts internal markdown links across the corpus", () => {
    const posts = [
      makePost({
        id: "a",
        slug: "alpha",
        bodyMdx: "See [bravo](/blog/bravo) and [charlie](/blog/charlie).",
      }),
      makePost({
        id: "b",
        slug: "bravo",
        bodyMdx: "Loop back to [alpha](/blog/alpha).",
      }),
      makePost({
        id: "c",
        slug: "charlie",
        bodyMdx: "Standalone.",
      }),
    ];
    const graph = buildLinkGraph({ posts, siteUrl: "https://example.com" });
    expect(graph.edges).toHaveLength(3);
    expect(graph.nodes.get("a")?.outDegree).toBe(2);
    expect(graph.nodes.get("a")?.inDegree).toBe(1);
    expect(graph.nodes.get("c")?.inDegree).toBe(1);
    expect(graph.nodes.get("c")?.outDegree).toBe(0);
  });

  it("flags orphans and dead-ends", () => {
    const posts = [
      makePost({
        id: "a",
        slug: "alpha",
        bodyMdx: "See [bravo](/blog/bravo).",
      }),
      makePost({ id: "b", slug: "bravo", bodyMdx: "Standalone." }),
      makePost({ id: "c", slug: "orphan", bodyMdx: "Standalone." }),
    ];
    const graph = buildLinkGraph({ posts, siteUrl: "https://example.com" });
    expect(graph.orphans.map((o) => o.slug).sort()).toEqual(["alpha", "orphan"]);
    expect(graph.deadEnds.map((d) => d.slug).sort()).toEqual(["bravo", "orphan"]);
  });

  it("ignores external links and self-references", () => {
    const posts = [
      makePost({
        id: "a",
        slug: "alpha",
        bodyMdx:
          "See [external](https://other.com/foo) and [self](/blog/alpha).",
      }),
    ];
    const graph = buildLinkGraph({ posts, siteUrl: "https://example.com" });
    expect(graph.edges).toEqual([]);
  });

  it("treats absolute URLs on the same host as internal", () => {
    const posts = [
      makePost({
        id: "a",
        slug: "alpha",
        bodyMdx: "See [bravo](https://example.com/blog/bravo).",
      }),
      makePost({ id: "b", slug: "bravo", bodyMdx: "ok" }),
    ];
    const graph = buildLinkGraph({ posts, siteUrl: "https://example.com" });
    expect(graph.edges).toHaveLength(1);
  });
});

describe("suggestInternalLinks", () => {
  it("ranks posts by tag overlap and content similarity", () => {
    const corpus: Post[] = [
      makePost({
        id: "a",
        slug: "react-hooks",
        title: "React hooks",
        bodyMdx: "useState useEffect hooks react render lifecycle component",
      }),
      makePost({
        id: "b",
        slug: "vue-composition",
        title: "Vue composition API",
        bodyMdx: "vue ref reactive computed watch composition api",
      }),
      makePost({
        id: "c",
        slug: "next-server-components",
        title: "Next.js server components",
        bodyMdx: "react server component nextjs streaming render",
      }),
    ];
    const suggestions = suggestInternalLinks({
      draft: {
        id: "draft",
        title: "React server components in 2026",
        bodyMdx: "react server component render hooks streaming nextjs",
      },
      corpus,
      postTags: new Map([
        ["a", ["react", "hooks"]],
        ["b", ["vue"]],
        ["c", ["react", "nextjs"]],
      ]),
      draftTagSlugs: ["react", "nextjs"],
    });
    expect(suggestions[0]?.slug).toBe("next-server-components");
    expect(suggestions.find((s) => s.slug === "vue-composition")).toBeUndefined();
  });

  it("excludes the draft post itself", () => {
    const draftPost = makePost({ id: "draft", slug: "draft", title: "Draft" });
    const suggestions = suggestInternalLinks({
      draft: { id: "draft", title: "Draft", bodyMdx: "ok" },
      corpus: [draftPost],
    });
    expect(suggestions).toEqual([]);
  });
});
