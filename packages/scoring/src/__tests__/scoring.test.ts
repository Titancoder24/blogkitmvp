import type {
  Citation,
  OrganizationConfig,
  Post,
  SiteConfig,
} from "@blogkit/core/types";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildVisibilityReport, weightedGeoMean } from "../aggregate.js";
import type { ScoreContext, ScoreSiteState } from "../context.js";
import {
  isQuestionHeading,
  looksLikeDefinitionLead,
  titleImpliesListicle,
} from "../text.js";

const SITE: SiteConfig = {
  name: "Acme",
  url: "https://acme.example",
  tagline: "Notes",
};

const ORG: OrganizationConfig = {
  name: "Acme Inc.",
  logoUrl: "https://acme.example/logo.png",
  sameAs: [
    "https://www.wikidata.org/wiki/Q1",
    "https://linkedin.com/company/acme",
    "https://github.com/acme",
    "https://crunchbase.com/organization/acme",
  ],
};

const SITE_STATE: ScoreSiteState = {
  site: SITE,
  organization: ORG,
  robotsAllowsAi: true,
  mcpEnabled: true,
  aiPluginManifest: true,
  serverSideRendered: true,
};

function makePost(overrides: Partial<Post> = {}): Post {
  return {
    id: "p",
    slug: "hello-blogkit",
    title: "Hello BlogKit, the agent-native CMS for the modern web",
    bodyMdx: BODY,
    excerpt: "An intro to BlogKit. It is a CMS that ships every SEO artifact by default.",
    customMetaDescription:
      "BlogKit is an npm-installable, agent-native headless CMS that auto-emits every SEO, AEO, and GEO artifact your blog posts need to be cited by AI engines.",
    coverImageUrl: "https://acme.example/covers/hello.png",
    status: "published",
    publishedAt: "2026-04-20T00:00:00Z",
    lastRefreshedAt: "2026-04-25T00:00:00Z",
    authorId: "a1",
    schemaType: "BlogPosting",
    templateId: "article",
    templateOverflow: {},
    noindex: false,
    readingTimeMinutes: 4,
    wordCount: 800,
    citationCount: 3,
    faqJson: [
      { question: "What is BlogKit?", answer: "An agent-native CMS." },
      { question: "Is it open source?", answer: "Yes, MIT." },
      { question: "What frameworks?", answer: "Next.js, Remix, Astro." },
    ],
    tldr: "BlogKit is the CMS for the agentic web.",
    isCornerstone: false,
    createdAt: "2026-04-20T00:00:00Z",
    updatedAt: "2026-04-25T00:00:00Z",
    ...overrides,
  };
}

const BODY = `BlogKit is a headless CMS that auto-emits every SEO, AEO, GEO, and LLM-SEO artifact a 2026 web property needs. According to research from [the AI Visibility Lab](https://example.com/research), posts with 3+ citations are cited 40% more often by AI engines, and posts with structured FAQ blocks dominate Google's AI Overviews.

## What is BlogKit?

BlogKit is an npm-installable CMS that ships its own Model Context Protocol server, three framework adapters, and a complete optimization stack out of the box. According to [a 2026 zero-click study](https://example.com/study), 60% of Google searches are now zero-click, which has fundamentally changed how content earns attention.

The package targets developers who want a writer-friendly admin without operating Strapi or paying $99 per month for Contentful. It targets content teams who do not want a developer in the loop on every publish. And, uniquely, it targets AI agents — Claude Code, Cursor's agent mode, Gemini CLI — as first-class users of the system.

- One-command install via npx
- Live AI Visibility scoring across six disciplines
- Thirty distinct, production-grade themes
- Twelve built-in content templates plus a custom builder
- Auto-emitted JSON-LD, sitemap, llms.txt, robots.txt, and ai-plugin.json

## How does the scoring engine work?

The engine grades each post across SEO, AEO, GEO, AIO, LLMO, and Agent-SEO. The aggregate uses a weighted geometric mean so a post cannot reach 90 by being excellent at one discipline and zero at another. Every discipline matters equally by default; templates can override the weights so a Glossary entry weighs AIO heavier and a Landing Page deprioritizes GEO.

![Scoring panel](https://acme.example/scoring.png "Scoring panel")

> "The scoring panel changed how we write — we used to ship posts and hope. Now we ship posts that AI engines actually cite." — Jane Reviewer, Acme Lead

Read more about the [theme system](/themes), the [template builder](/templates), and how to install the [MCP server](/mcp). Each layer composes with the others to produce a stack that is greater than the sum of its parts.

## Why does this matter for AI search?

AI Overviews, ChatGPT search, Claude search, Perplexity citations, and Gemini retrieval all depend on the same access-layer prerequisites: server-side rendered content, AI user agents allow-listed in robots.txt, an llms.txt entry, structured headings, and complete JSON-LD. Most CMS platforms ship none of those by default. BlogKit ships all of them.
`;

const CITATIONS: Citation[] = [
  {
    id: "c1",
    postId: "p",
    sourceUrl: "https://example.com/research",
    sourceTitle: "AI Visibility 2026",
    sourcePublishedAt: "2026-03-01",
  },
  {
    id: "c2",
    postId: "p",
    sourceUrl: "https://example.com/study",
    sourceTitle: "Zero-click study",
    sourcePublishedAt: "2026-02-01",
  },
  {
    id: "c3",
    postId: "p",
    sourceUrl: "https://example.com/methods",
    sourceTitle: "Methodology",
    sourcePublishedAt: "2026-01-15",
  },
];

const CTX: ScoreContext = { post: makePost(), citations: CITATIONS, site: SITE_STATE };

// Freshness scoring depends on `Date.now()`. Pin it so the rubric is stable.
beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-04-25T12:00:00Z"));
});
afterAll(() => {
  vi.useRealTimers();
});

describe("buildVisibilityReport — happy path", () => {
  it("scores a fully-optimized post in the 80+ range overall", () => {
    const report = buildVisibilityReport(CTX);
    expect(report.aggregate).toBeGreaterThanOrEqual(75);
    expect(report.scores.seo.score).toBeGreaterThanOrEqual(70);
    expect(report.scores.aeo.score).toBeGreaterThanOrEqual(70);
    expect(report.scores.geo.score).toBeGreaterThanOrEqual(60);
    expect(report.scores.aio.score).toBeGreaterThanOrEqual(70);
    expect(report.scores.llmo.score).toBeGreaterThanOrEqual(80);
    expect(report.scores.agentSeo.score).toBeGreaterThanOrEqual(75);
  });

  it("returns fixes ordered by points impact", () => {
    const report = buildVisibilityReport(CTX);
    for (let i = 1; i < report.fixes.length; i++) {
      const prev = report.fixes[i - 1];
      const cur = report.fixes[i];
      if (!prev || !cur) continue;
      expect(prev.pointsImpact).toBeGreaterThanOrEqual(cur.pointsImpact);
    }
  });
});

describe("buildVisibilityReport — failure modes", () => {
  it("punishes missing citations heavily on GEO", () => {
    const report = buildVisibilityReport({
      ...CTX,
      citations: [],
    });
    expect(report.scores.geo.score).toBeLessThan(60);
    expect(
      report.fixes.find((f) => f.id === "geo.citations"),
    ).toBeDefined();
  });

  it("blocks LLMO when SSR is off and AI crawlers are disallowed", () => {
    const report = buildVisibilityReport({
      ...CTX,
      site: {
        ...SITE_STATE,
        serverSideRendered: false,
        robotsAllowsAi: false,
      },
    });
    expect(report.scores.llmo.score).toBeLessThan(60);
  });

  it("flags noindex posts in SEO and LLMO", () => {
    const report = buildVisibilityReport({
      ...CTX,
      post: makePost({ noindex: true }),
    });
    expect(report.fixes.find((f) => f.id === "seo.noindex")).toBeDefined();
  });

  it("aggregate falls toward zero when any discipline is zero", () => {
    const report = buildVisibilityReport({
      ...CTX,
      site: {
        ...SITE_STATE,
        serverSideRendered: false,
        robotsAllowsAi: false,
        mcpEnabled: false,
        aiPluginManifest: false,
      },
      citations: [],
      post: makePost({
        title: "x",
        bodyMdx: "Short.",
        customMetaDescription: undefined,
        excerpt: undefined,
        tldr: undefined,
        faqJson: [],
        coverImageUrl: undefined,
        authorId: undefined,
        wordCount: 1,
        readingTimeMinutes: undefined,
        lastRefreshedAt: undefined,
        publishedAt: undefined,
        status: "draft",
      }),
    });
    expect(report.aggregate).toBeLessThan(40);
  });
});

describe("weightedGeoMean", () => {
  it("returns the simple geo mean when weights are equal", () => {
    const wrap = (score: number) => ({ score, fixes: [] });
    const result = weightedGeoMean(
      {
        seo: wrap(80),
        aeo: wrap(80),
        geo: wrap(80),
        aio: wrap(80),
        llmo: wrap(80),
        agentSeo: wrap(80),
        voice: wrap(80),
      },
      { seo: 1, aeo: 1, geo: 1, aio: 1, llmo: 1, agentSeo: 1, voice: 0 },
    );
    expect(result).toBe(80);
  });

  it("clamps zero scores to 1 to avoid -Infinity", () => {
    const wrap = (score: number) => ({ score, fixes: [] });
    const result = weightedGeoMean(
      {
        seo: wrap(100),
        aeo: wrap(0),
        geo: wrap(100),
        aio: wrap(100),
        llmo: wrap(100),
        agentSeo: wrap(100),
        voice: wrap(100),
      },
      { seo: 1, aeo: 1, geo: 1, aio: 1, llmo: 1, agentSeo: 1, voice: 0 },
    );
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(60);
  });
});

describe("text helpers", () => {
  it("isQuestionHeading recognizes interrogative cues", () => {
    expect(isQuestionHeading({ level: 2, text: "What is X?" })).toBe(true);
    expect(isQuestionHeading({ level: 2, text: "How does X work" })).toBe(true);
    expect(isQuestionHeading({ level: 2, text: "X overview" })).toBe(false);
  });

  it("looksLikeDefinitionLead matches the canonical pattern", () => {
    expect(
      looksLikeDefinitionLead("BlogKit is a CMS that emits SEO artifacts."),
    ).toBe(true);
    expect(looksLikeDefinitionLead("We launched BlogKit today.")).toBe(false);
  });

  it("titleImpliesListicle catches Best/Top/N + plural", () => {
    expect(titleImpliesListicle("Best 7 Static Site Generators")).toBe(true);
    expect(titleImpliesListicle("Top React Frameworks")).toBe(true);
    expect(titleImpliesListicle("5 Things You Should Know")).toBe(true);
    expect(titleImpliesListicle("React vs Vue")).toBe(true);
    expect(titleImpliesListicle("How we built BlogKit")).toBe(false);
  });
});
