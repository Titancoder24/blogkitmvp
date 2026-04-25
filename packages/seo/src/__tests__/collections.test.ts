import type { Post, SiteConfig } from "@blogkit/core/types";
import { describe, expect, it } from "vitest";
import {
  BUILT_IN_COLLECTIONS,
  buildCollectionPages,
  collectionSitemapEntries,
} from "../collections.js";

const SITE: SiteConfig = { name: "Acme", url: "https://acme.example" };

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
    publishedAt: "2026-04-01T00:00:00Z",
    ...overrides,
  } as Post;
}

describe("buildCollectionPages", () => {
  it("groups published posts by template into the built-in collections", () => {
    const posts = [
      makePost({ id: "1", slug: "what-is-aeo", templateId: "glossary" }),
      makePost({ id: "2", slug: "what-is-geo", templateId: "glossary" }),
      makePost({ id: "3", slug: "react-frameworks", templateId: "listicle" }),
      makePost({ id: "4", slug: "draft", templateId: "glossary", status: "draft" }),
    ];
    const pages = buildCollectionPages({ site: SITE, posts });
    const glossary = pages.find((p) => p.definition.path === "/glossary");
    const lists = pages.find((p) => p.definition.path === "/best");
    expect(glossary?.posts.map((p) => p.id).sort()).toEqual(["1", "2"]);
    expect(lists?.posts.map((p) => p.id)).toEqual(["3"]);
  });

  it("emits CollectionPage + ItemList + Breadcrumb JSON-LD", () => {
    const posts = [makePost({ id: "1", slug: "term", templateId: "glossary" })];
    const [page] = buildCollectionPages({ site: SITE, posts });
    expect(page).toBeDefined();
    expect(page!.jsonLd[0]?.["@type"]).toBe("CollectionPage");
    const itemList = (page!.jsonLd[0] as Record<string, unknown>).mainEntity as Record<
      string,
      unknown
    >;
    expect(itemList["@type"]).toBe("ItemList");
    expect(itemList.numberOfItems).toBe(1);
    expect(page!.jsonLd[1]?.["@type"]).toBe("BreadcrumbList");
  });

  it("skips empty collections by default", () => {
    const pages = buildCollectionPages({ site: SITE, posts: [] });
    expect(pages).toHaveLength(0);
  });

  it("ranks cornerstone posts first", () => {
    const posts = [
      makePost({
        id: "1",
        slug: "common",
        templateId: "glossary",
        publishedAt: "2026-04-20T00:00:00Z",
      }),
      makePost({
        id: "2",
        slug: "pillar",
        templateId: "glossary",
        publishedAt: "2025-01-01T00:00:00Z",
        isCornerstone: true,
      }),
    ];
    const [page] = buildCollectionPages({ site: SITE, posts });
    expect(page?.posts[0]?.id).toBe("2");
  });

  it("provides one sitemap entry per emitted collection", () => {
    const posts = [
      makePost({ id: "1", slug: "g", templateId: "glossary" }),
      makePost({ id: "2", slug: "r", templateId: "review" }),
    ];
    const pages = buildCollectionPages({ site: SITE, posts });
    const entries = collectionSitemapEntries(pages);
    expect(entries.map((e) => e.url).sort()).toEqual(["/glossary", "/reviews"]);
  });

  it("covers every built-in template family", () => {
    const families = BUILT_IN_COLLECTIONS.map((c) => c.templateId).sort();
    expect(families).toEqual([
      "case-study",
      "comparison",
      "faq-hub",
      "glossary",
      "how-to",
      "listicle",
      "news",
      "product",
      "recipe",
      "review",
    ]);
  });
});
