import { describe, expect, it } from "vitest";
import { buildLlmsFullTxt, buildLlmsTxt } from "../llms-txt.js";

const SITE = {
  name: "Acme Blog",
  url: "https://acme.example",
  tagline: "Notes from the Acme team",
};

describe("buildLlmsTxt", () => {
  it("ranks cornerstone first, then most recently refreshed", () => {
    const out = buildLlmsTxt({
      site: SITE,
      posts: [
        {
          post: {
            slug: "old-decayed",
            title: "Old Decayed",
            excerpt: "Old.",
            tldr: undefined,
            publishedAt: "2024-01-01T00:00:00Z",
            lastRefreshedAt: undefined,
            templateId: "article",
            isCornerstone: false,
          },
        },
        {
          post: {
            slug: "fresh-listicle",
            title: "5 Fresh Things",
            excerpt: undefined,
            tldr: "Five things you should know.",
            publishedAt: "2025-12-01T00:00:00Z",
            lastRefreshedAt: "2026-04-20T00:00:00Z",
            templateId: "listicle",
            isCornerstone: false,
          },
        },
        {
          post: {
            slug: "pillar",
            title: "Cornerstone Pillar",
            excerpt: "Pillar content.",
            tldr: undefined,
            publishedAt: "2023-06-01T00:00:00Z",
            lastRefreshedAt: "2026-01-01T00:00:00Z",
            templateId: "article",
            isCornerstone: true,
          },
        },
      ],
    });

    const pillarIdx = out.indexOf("Cornerstone Pillar");
    const freshIdx = out.indexOf("5 Fresh Things");
    const oldIdx = out.indexOf("Old Decayed");

    expect(pillarIdx).toBeGreaterThan(-1);
    expect(freshIdx).toBeGreaterThan(-1);
    expect(oldIdx).toBeGreaterThan(-1);
    expect(pillarIdx).toBeLessThan(freshIdx);
    expect(freshIdx).toBeLessThan(oldIdx);
  });

  it("groups posts by template-derived section", () => {
    const out = buildLlmsTxt({
      site: SITE,
      posts: [
        {
          post: {
            slug: "what-is-x",
            title: "What is X",
            excerpt: "Defines X.",
            tldr: undefined,
            publishedAt: "2026-04-01T00:00:00Z",
            lastRefreshedAt: undefined,
            templateId: "glossary",
            isCornerstone: false,
          },
        },
        {
          post: {
            slug: "x-vs-y",
            title: "X vs Y",
            excerpt: undefined,
            tldr: undefined,
            publishedAt: "2026-04-02T00:00:00Z",
            lastRefreshedAt: undefined,
            templateId: "comparison",
            isCornerstone: false,
          },
        },
      ],
    });
    expect(out).toContain("## Glossary");
    expect(out).toContain("## Comparisons");
  });

  it("respects maxLinks", () => {
    const out = buildLlmsTxt({
      site: SITE,
      maxLinks: 1,
      posts: Array.from({ length: 5 }, (_, i) => ({
        post: {
          slug: `p${i}`,
          title: `Post ${i}`,
          excerpt: undefined,
          tldr: undefined,
          publishedAt: `2026-04-0${i + 1}T00:00:00Z`,
          lastRefreshedAt: undefined,
          templateId: "article",
          isCornerstone: false,
        },
      })),
    });
    const linkLines = out.split("\n").filter((l) => l.startsWith("- ["));
    expect(linkLines).toHaveLength(1);
  });
});

describe("buildLlmsFullTxt", () => {
  it("orders posts by ranking and includes full body", () => {
    const out = buildLlmsFullTxt({
      site: SITE,
      posts: [
        {
          post: {
            slug: "a",
            title: "Post A",
            bodyMdx: "Body of A.",
            excerpt: undefined,
            tldr: undefined,
            publishedAt: "2026-04-01T00:00:00Z",
            lastRefreshedAt: undefined,
            templateId: "article",
            isCornerstone: false,
          },
        },
        {
          post: {
            slug: "b",
            title: "Post B",
            bodyMdx: "Body of B.",
            excerpt: undefined,
            tldr: undefined,
            publishedAt: "2026-04-15T00:00:00Z",
            lastRefreshedAt: undefined,
            templateId: "article",
            isCornerstone: false,
          },
        },
      ],
    });
    expect(out).toContain("Body of A.");
    expect(out).toContain("Body of B.");
    expect(out.indexOf("Post B")).toBeLessThan(out.indexOf("Post A"));
  });
});
