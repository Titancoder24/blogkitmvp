import type {
  Author,
  Citation,
  OrganizationConfig,
  Post,
  SiteConfig,
} from "@blogkit/core/types";
import { describe, expect, it } from "vitest";
import {
  blogPostingJsonLd,
  breadcrumbListJsonLd,
  buildPostJsonLdStack,
  faqPageJsonLd,
  organizationJsonLd,
  webSiteJsonLd,
} from "../jsonld.js";

const SITE: SiteConfig = {
  name: "Acme Blog",
  url: "https://acme.example",
  tagline: "Notes from the Acme team",
};

const ORG: OrganizationConfig = {
  name: "Acme Inc.",
  logoUrl: "https://acme.example/logo.png",
  sameAs: [
    "https://www.wikidata.org/wiki/Q1",
    "https://linkedin.com/company/acme",
    "https://github.com/acme",
  ],
};

const AUTHOR: Author = {
  id: "author-1",
  name: "Jane Author",
  bio: "Engineer at Acme.",
  avatarUrl: "https://acme.example/avatars/jane.png",
  twitter: "https://twitter.com/jane",
  linkedin: "https://linkedin.com/in/jane",
  github: "https://github.com/jane",
  website: "https://jane.dev",
  sameAs: ["https://jane.dev"],
  role: "admin",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const POST: Post = {
  id: "post-1",
  slug: "hello-blogkit",
  title: "Hello BlogKit",
  bodyMdx: "BlogKit is a CMS that auto-emits SEO artifacts.",
  bodyHtml: "<p>BlogKit is a CMS that auto-emits SEO artifacts.</p>",
  excerpt: "An intro to BlogKit.",
  coverImageUrl: "https://acme.example/covers/hello.png",
  status: "published",
  publishedAt: "2026-04-20T00:00:00Z",
  lastRefreshedAt: "2026-04-25T00:00:00Z",
  authorId: "author-1",
  schemaType: "BlogPosting",
  templateId: "article",
  templateOverflow: {},
  noindex: false,
  readingTimeMinutes: 4,
  wordCount: 800,
  citationCount: 3,
  faqJson: [
    { question: "What is BlogKit?", answer: "An agent-native headless CMS." },
    { question: "Is it open source?", answer: "Yes — MIT licensed." },
  ],
  tldr: "BlogKit is the CMS for the agentic web.",
  isCornerstone: true,
  createdAt: "2026-04-20T00:00:00Z",
  updatedAt: "2026-04-25T00:00:00Z",
};

const CITATIONS: Citation[] = [
  {
    id: "c1",
    postId: "post-1",
    sourceUrl: "https://example.com/research",
    sourceTitle: "AI Visibility Study 2026",
    sourceAuthor: "Smith, J.",
    sourcePublishedAt: "2026-03-01",
    excerpt: "Posts with 3+ citations are 40% more likely to be cited by AI.",
    positionInPost: 0,
  },
];

describe("blogPostingJsonLd", () => {
  it("emits a fully-populated BlogPosting", () => {
    const ld = blogPostingJsonLd({
      post: POST,
      author: AUTHOR,
      site: SITE,
      organization: ORG,
      citations: CITATIONS,
    });
    expect(ld["@type"]).toBe("BlogPosting");
    expect(ld["@id"]).toBe("https://acme.example/blog/hello-blogkit#post");
    expect(ld.headline).toBe("Hello BlogKit");
    expect(ld.url).toBe("https://acme.example/blog/hello-blogkit");
    expect(ld.dateModified).toBe("2026-04-25T00:00:00.000Z");
    expect(ld.publisher).toMatchObject({ "@type": "Organization", name: "Acme Inc." });
    expect(ld.author).toMatchObject({ "@type": "Person", name: "Jane Author" });
    expect(ld.citation).toHaveLength(1);
  });

  it("prunes undefined fields", () => {
    const minimalPost: Post = { ...POST, excerpt: undefined, tldr: undefined };
    const ld = blogPostingJsonLd({
      post: { ...minimalPost, customMetaDescription: undefined },
      site: SITE,
      organization: { ...ORG, sameAs: [] },
    });
    expect(ld).not.toHaveProperty("description");
    expect((ld.publisher as Record<string, unknown>).sameAs).toBeUndefined();
  });
});

describe("buildPostJsonLdStack", () => {
  it("emits BlogPosting + WebSite + Organization + Breadcrumb + FAQ", () => {
    const stack = buildPostJsonLdStack({
      post: POST,
      author: AUTHOR,
      site: SITE,
      organization: ORG,
      citations: CITATIONS,
    });
    const types = stack.map((s) => s["@type"]);
    expect(types).toEqual([
      "BlogPosting",
      "WebSite",
      "Organization",
      "BreadcrumbList",
      "FAQPage",
    ]);
  });

  it("omits FAQPage when no FAQ items", () => {
    const stack = buildPostJsonLdStack({
      post: { ...POST, faqJson: [] },
      author: AUTHOR,
      site: SITE,
      organization: ORG,
    });
    expect(stack.find((s) => s["@type"] === "FAQPage")).toBeUndefined();
  });
});

describe("faqPageJsonLd", () => {
  it("returns null for empty input", () => {
    expect(faqPageJsonLd([])).toBeNull();
  });

  it("emits Question/Answer pairs", () => {
    const ld = faqPageJsonLd([
      { question: "Q1", answer: "A1" },
      { question: "Q2", answer: "A2" },
    ]);
    expect(ld).toMatchObject({
      "@type": "FAQPage",
      mainEntity: [
        { "@type": "Question", name: "Q1", acceptedAnswer: { text: "A1" } },
        { "@type": "Question", name: "Q2", acceptedAnswer: { text: "A2" } },
      ],
    });
  });
});

describe("breadcrumbListJsonLd", () => {
  it("numbers list items 1-indexed", () => {
    const ld = breadcrumbListJsonLd("https://acme.example", [
      { name: "Home", url: "/" },
      { name: "Blog", url: "/blog" },
    ]);
    expect(ld.itemListElement).toEqual([
      { "@type": "ListItem", position: 1, name: "Home", item: "https://acme.example/" },
      { "@type": "ListItem", position: 2, name: "Blog", item: "https://acme.example/blog" },
    ]);
  });
});

describe("webSiteJsonLd", () => {
  it("includes a SearchAction with the blog query target", () => {
    const ld = webSiteJsonLd(SITE);
    expect((ld.potentialAction as Record<string, unknown>).target).toBe(
      "https://acme.example/blog?q={search_term_string}",
    );
  });
});

describe("organizationJsonLd", () => {
  it("emits a stable @id keyed off the site URL", () => {
    const ld = organizationJsonLd({ site: SITE, organization: ORG });
    expect(ld["@id"]).toBe("https://acme.example#org");
  });
});
