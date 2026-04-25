import type { Citation, Post } from "@blogkit/core/types";
import { describe, expect, it } from "vitest";
import { extractForChatGpt, extractForGooglebot } from "../view-as.js";

function makePost(overrides: Partial<Post> = {}): Post {
  return {
    id: "p",
    slug: "hello",
    title: "Hello World",
    bodyMdx: "",
    status: "published",
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

const BODY = `BlogKit is an agent-native CMS that ships every SEO artifact by default.

## What is it for?

It targets developers who want a writer-friendly admin without operating Strapi. According to [research](https://example.com/r), 60% of searches are now zero-click.

![hero](https://acme.example/h.png "Hero")

## How does it score posts?

Six disciplines, weighted geometric mean. The [scoring panel](/blog/scoring) updates live.
`;

describe("extractForChatGpt", () => {
  it("returns Definition-Lead, sections, FAQs, statistics, and citations", () => {
    const post = makePost({
      bodyMdx: BODY,
      tldr: "BlogKit auto-emits SEO artifacts.",
      faqJson: [{ question: "Q1?", answer: "A1." }],
    });
    const citations: Citation[] = [
      {
        id: "c1",
        postId: "p",
        sourceUrl: "https://example.com/r",
        sourceTitle: "Research",
      },
    ];
    const out = extractForChatGpt({ post, citations, authorName: "Jane" });

    expect(out.definitionLead).toMatch(/^BlogKit is/);
    expect(out.definitionLeadValid).toBe(true);
    expect(out.tldr).toBe("BlogKit auto-emits SEO artifacts.");
    expect(out.sections.length).toBeGreaterThanOrEqual(2);
    expect(out.sections[0]?.heading).toBe("What is it for?");
    expect(out.faqs).toHaveLength(1);
    expect(out.statistics.length).toBeGreaterThan(0);
    expect(out.statistics[0]?.hasNearbySource).toBe(true);
    expect(out.citations).toHaveLength(1);
    expect(out.meta.author).toBe("Jane");
  });

  it("handles bodies with no headings by returning a single (opening) section", () => {
    const post = makePost({ bodyMdx: "BlogKit is great. It also ships fast." });
    const out = extractForChatGpt({ post });
    expect(out.sections).toHaveLength(1);
    expect(out.sections[0]?.heading).toBe("(opening)");
  });
});

describe("extractForGooglebot", () => {
  it("builds the heading outline and image audit", () => {
    const post = makePost({
      bodyMdx: BODY,
      coverImageUrl: "https://acme.example/cover.png",
      customMetaDescription: "An intro to BlogKit.",
    });
    const out = extractForGooglebot({ post, siteUrl: "https://acme.example" });
    expect(out.outline.map((h) => h.text)).toEqual([
      "What is it for?",
      "How does it score posts?",
    ]);
    expect(out.canonical).toBe("https://acme.example/blog/hello");
    expect(out.imageAudit).toHaveLength(1);
    expect(out.imageAudit[0]?.alt).toBe("hero");
    expect(out.socialMeta.twitterCardType).toBe("summary_large_image");
  });

  it("flags missing alt text and skipped heading levels", () => {
    const broken = `Body opening.

![](https://acme.example/h.png)

# Big heading

#### Skipped levels

Some text.
`;
    const post = makePost({ bodyMdx: broken, customMetaDescription: "ok" });
    const out = extractForGooglebot({ post });
    const ids = out.issues.map((i) => i.id);
    expect(ids).toContain("alt.missing");
    expect(ids).toContain("heading.skipped-level");
  });

  it("flags a noindex post as an error", () => {
    const post = makePost({
      bodyMdx: "Body.",
      noindex: true,
      customMetaDescription: "ok",
    });
    const out = extractForGooglebot({ post });
    expect(
      out.issues.find((i) => i.id === "robots.noindex")?.severity,
    ).toBe("error");
  });
});
