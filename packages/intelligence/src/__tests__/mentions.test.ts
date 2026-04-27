import { describe, expect, it } from "vitest";
import {
  type AiModelProber,
  probeMentions,
  summarizeMentions,
  createStubProber,
} from "../mentions.js";

const NOW = () => new Date("2026-04-25T00:00:00Z");

const QUERY = { id: "q1", query: "best Next.js CMS" };

function fixedProber(opts: {
  provider: AiModelProber["provider"];
  answer: string;
  citationUrls: readonly string[];
}): AiModelProber {
  return {
    provider: opts.provider,
    async probe() {
      return { answer: opts.answer, citationUrls: opts.citationUrls };
    },
  };
}

describe("probeMentions", () => {
  it("detects own-domain citations and assigns a rank", async () => {
    const probers = [
      fixedProber({
        provider: "claude",
        answer:
          "I'd recommend BlogKit, see https://acme.example/blog/hello and https://other.com/foo.",
        citationUrls: [
          "https://other.com/foo",
          "https://acme.example/blog/hello",
        ],
      }),
    ];
    const results = await probeMentions({
      query: QUERY,
      probers,
      ownDomains: ["acme.example"],
      postUrls: new Map([["hello", "https://acme.example/blog/hello"]]),
      now: NOW,
    });
    expect(results).toHaveLength(1);
    const r = results[0]!;
    expect(r.wasCited).toBe(true);
    expect(r.citedSlugs).toEqual(["hello"]);
    expect(r.competitorDomains).toEqual(["other.com"]);
    expect(r.citationRank).toBe(2); // own-domain was the second link
  });

  it("captures probe errors as their own row", async () => {
    const failing: AiModelProber = {
      provider: "chatgpt",
      async probe() {
        throw new Error("rate limit");
      },
    };
    const results = await probeMentions({
      query: QUERY,
      probers: [failing],
      ownDomains: ["acme.example"],
      now: NOW,
    });
    expect(results[0]?.wasCited).toBe(false);
    expect(results[0]?.excerpt).toMatch(/__probe_error__/);
    expect(results[0]?.meta).toEqual({ error: true });
  });

  it("recognises inline URLs even without a structured citation list", async () => {
    const probers = [
      fixedProber({
        provider: "perplexity",
        answer: "Compare https://acme.example/post — and https://other.com/foo.",
        citationUrls: [],
      }),
    ];
    const [r] = await probeMentions({
      query: QUERY,
      probers,
      ownDomains: ["acme.example"],
      now: NOW,
    });
    expect(r?.wasCited).toBe(true);
    expect(r?.competitorDomains).toEqual(["other.com"]);
  });
});

describe("summarizeMentions", () => {
  it("aggregates citation rate, share-of-voice, and per-provider stats", () => {
    const results = [
      {
        queryId: "q1",
        provider: "claude" as const,
        probedAt: "2026-04-25T00:00:00Z",
        wasCited: true,
        citedSlugs: ["hello"],
        competitorDomains: ["other.com"],
        citationRank: 1,
        excerpt: "",
        meta: {},
      },
      {
        queryId: "q1",
        provider: "claude" as const,
        probedAt: "2026-04-25T01:00:00Z",
        wasCited: false,
        citedSlugs: [],
        competitorDomains: ["other.com", "third.com"],
        citationRank: null,
        excerpt: "",
        meta: {},
      },
      {
        queryId: "q1",
        provider: "chatgpt" as const,
        probedAt: "2026-04-25T01:00:00Z",
        wasCited: true,
        citedSlugs: ["hello", "world"],
        competitorDomains: [],
        citationRank: 2,
        excerpt: "",
        meta: {},
      },
    ];
    const rollup = summarizeMentions({ query: QUERY, results });
    expect(rollup.totalProbes).toBe(3);
    expect(rollup.totalCitations).toBe(2);
    expect(rollup.citationRate).toBeCloseTo(66.7, 1);
    expect(rollup.byProvider.claude.totalProbes).toBe(2);
    expect(rollup.byProvider.claude.citationRate).toBe(50);
    expect(rollup.byProvider.chatgpt.citationRate).toBe(100);
    expect(rollup.topCompetitors[0]?.domain).toBe("other.com");
    expect(rollup.topSlugs[0]?.slug).toBe("hello");
  });
});

describe("createStubProber", () => {
  it("returns a deterministic stub answer", async () => {
    const stub = createStubProber("gemini");
    const out = await stub.probe("test");
    expect(out.answer).toContain("[stub:gemini]");
    expect(out.citationUrls).toEqual([]);
  });
});
