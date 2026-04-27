import type { Post } from "@blogkit/core/types";
import { describe, expect, it } from "vitest";
import { suggestAltText, suggestAltTextBatch } from "../alt-text.js";
import { pickWinner, scoreHeadline } from "../headlines.js";
import { analyzeTopicGaps } from "../topic-gaps.js";
import { scoreVoice } from "../voice.js";

function makePost(overrides: Partial<Post> = {}): Post {
  return {
    id: overrides.id ?? "p",
    slug: overrides.slug ?? "post",
    title: overrides.title ?? "Post",
    bodyMdx: overrides.bodyMdx ?? "Body.",
    status: overrides.status ?? "published",
    schemaType: "BlogPosting",
    templateId: "article",
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

// ---------- voice ----------
describe("scoreVoice", () => {
  const guide = {
    banned: ["revolutionary", "game-changing"],
    required: ["BlogKit"],
    tone: ["practical", "concrete", "honest"],
    minSentenceWords: 6,
    maxSentenceWords: 24,
  };

  it("rewards a post that hits required, tone, and sentence-length bands", () => {
    const result = scoreVoice({
      bodyMdx:
        "BlogKit ships practical, concrete defaults that respect every reader's time. The honest aim is documentation a working developer can actually use without scrolling endlessly through marketing pages.",
      title: "BlogKit launches the practical Next.js CMS for working developers",
      guide,
    });
    expect(result.score).toBeGreaterThan(85);
    expect(result.fixes.find((f) => f.id === "voice.banned")).toBeUndefined();
  });

  it("penalizes banned phrases", () => {
    const result = scoreVoice({
      bodyMdx: "BlogKit is a revolutionary CMS that ships practical defaults.",
      guide,
    });
    expect(result.score).toBeLessThan(80);
    expect(result.fixes.find((f) => f.id === "voice.banned")).toBeDefined();
  });

  it("flags missing required phrases", () => {
    const result = scoreVoice({
      bodyMdx: "We ship practical concrete honest defaults.",
      guide,
    });
    expect(result.fixes.find((f) => f.id === "voice.required")).toBeDefined();
  });

  it("flags sentences outside the band", () => {
    const result = scoreVoice({
      bodyMdx: "BlogKit. Short. Practical.",
      guide,
    });
    expect(result.fixes.find((f) => f.id === "voice.sentence-length")).toBeDefined();
  });
});

// ---------- headlines ----------
describe("scoreHeadline / pickWinner", () => {
  it("ranks the listicle-aligned, length-ideal variant first", () => {
    const variants = [
      { id: "a", text: "BlogKit launches" },
      // 50–60 chars, listicle pattern matches `\d+\s+reasons`, brand is
      // front-loaded, exactly one power word ("modern"). Should win.
      { id: "b", text: "BlogKit: 5 reasons it's the modern Next.js CMS" },
      { id: "c", text: "BlogKit" },
    ];
    const result = pickWinner({
      variants,
      targetKeyword: "BlogKit",
      requiredBrand: "BlogKit",
      bodyHasList: true,
    });
    expect(result.winner.variantId).toBe("b");
  });

  it("rewards question-format headlines", () => {
    const score = scoreHeadline({
      variant: { id: "q", text: "Why does BlogKit ship robots.txt by default?" },
      targetKeyword: "BlogKit",
      requiredBrand: "BlogKit",
    });
    expect(score.breakdown.questionBonus).toBe(1);
    expect(score.score).toBeGreaterThan(60);
  });

  it("penalizes emoji headlines", () => {
    const score = scoreHeadline({
      variant: { id: "e", text: "🚀 BlogKit launches the agent-native CMS!" },
      targetKeyword: "BlogKit",
      requiredBrand: "BlogKit",
    });
    expect(score.breakdown.emojiPenalty).toBeLessThan(0);
  });

  it("flags a listicle title with no list in the body", () => {
    const score = scoreHeadline({
      variant: { id: "l", text: "5 Reasons BlogKit is the modern CMS" },
      bodyHasList: false,
    });
    expect(score.notes.find((n) => /list but the body has no list/.test(n))).toBeDefined();
  });
});

// ---------- topic gaps ----------
describe("analyzeTopicGaps", () => {
  it("clusters by tag and surfaces under-covered tokens", () => {
    const posts = [
      makePost({
        id: "1",
        slug: "react-hooks",
        title: "React hooks deep dive",
        bodyMdx: "useState useEffect hooks render component lifecycle",
      }),
      makePost({
        id: "2",
        slug: "react-ssr",
        title: "Server-side rendering with React",
        bodyMdx: "react server rendering streaming hydration",
      }),
      makePost({
        id: "3",
        slug: "react-state",
        title: "React state libraries",
        bodyMdx: "react state redux zustand jotai",
      }),
    ];
    const tags = new Map([
      ["1", ["react"]],
      ["2", ["react"]],
      ["3", ["react"]],
    ]);
    const report = analyzeTopicGaps({ posts, postTags: tags });
    expect(report.clusters[0]?.label).toBe("React");
    expect(report.clusters[0]?.gaps.length).toBeGreaterThan(0);
  });

  it("ignores clusters smaller than minClusterSize", () => {
    const posts = [makePost({ id: "1" }), makePost({ id: "2" })];
    const tags = new Map([
      ["1", ["react"]],
      ["2", ["react"]],
    ]);
    const report = analyzeTopicGaps({ posts, postTags: tags, minClusterSize: 3 });
    expect(report.clusters).toHaveLength(0);
  });
});

// ---------- alt text ----------
describe("suggestAltText", () => {
  it("uses the model when present and trims to maxChars", async () => {
    const longText = "x".repeat(200);
    const result = await suggestAltText({
      imageUrl: "https://acme.example/img.jpg",
      context: "Hero shot",
      maxChars: 50,
      model: {
        id: "stub",
        async describe() {
          return { altText: longText, confidence: 0.9 };
        },
      },
    });
    expect(result.source).toBe("model");
    expect(result.altText.length).toBe(50);
    expect(result.modelId).toBe("stub");
  });

  it("falls back to heuristic on model failure", async () => {
    const result = await suggestAltText({
      imageUrl: "https://acme.example/cover-launch-2026.png",
      context: "showing the new dashboard",
      model: {
        id: "broken",
        async describe() {
          throw new Error("rate limit");
        },
      },
    });
    expect(result.source).toBe("heuristic");
    expect(result.altText.length).toBeGreaterThan(0);
  });

  it("derives heuristic alt from the filename when no context exists", async () => {
    const result = await suggestAltText({
      imageUrl: "https://acme.example/rocket-launch.png",
      context: "",
    });
    expect(result.altText.toLowerCase()).toContain("rocket");
  });

  it("walks every image in a body via suggestAltTextBatch", async () => {
    const body = "![](https://acme.example/a.png)\n![](https://acme.example/b.png)";
    const out = await suggestAltTextBatch({
      bodyMdx: body,
      contextByUrl: new Map(),
    });
    expect(out.size).toBe(2);
  });
});
