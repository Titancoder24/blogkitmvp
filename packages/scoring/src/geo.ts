/**
 * Generative Engine Optimization scorer (PRD §5B.1, §6.3).
 *
 * GEO targets citation share by ChatGPT, Claude, Perplexity, Gemini,
 * Copilot, and DeepSeek. Research consistently shows three levers move the
 * needle most: citation count (3+ raises AI visibility ~40%), statistic
 * density with attribution, and neutral fact-driven prose over marketing
 * language. The rubric weights those three highest.
 */
import type { DisciplineScore } from "@blogkit/core/types";
import { type ScoreContext, withBody } from "./context.js";
import { type Check, clamp01, lerp, runRubric } from "./util.js";
import {
  countNumericClaims,
  marketingLanguageRatio,
  titleImpliesListicle,
} from "./text.js";

export function scoreGeo(rawCtx: ScoreContext): DisciplineScore {
  const ctx = withBody(rawCtx);
  const { post, citations, body } = ctx;
  const numericClaims = countNumericClaims(body.clean);
  const claimsPerKilo = body.wordCount === 0 ? 0 : (numericClaims * 1000) / body.wordCount;
  const marketingRatio = marketingLanguageRatio(body.clean);
  const wantsListicle = titleImpliesListicle(post.title);
  const looksListicle = body.hasLists || /^\s*\d+\.\s/m.test(body.raw);

  const checks: Check[] = [
    {
      id: "geo.citations",
      points: 30,
      earned: citationScore(citations.length),
      fix: {
        message:
          citations.length === 0
            ? "No citations. Research shows posts with 3+ citations are cited by AI engines up to 40% more often. Add citation blocks."
            : citations.length < 3
            ? `Only ${citations.length} citation(s). Aim for 3+ to pass the GEO citation threshold.`
            : "",
        effort: citations.length === 0 ? "writing" : "writing",
      },
    },
    {
      id: "geo.statistic-density",
      points: 15,
      earned: lerp(claimsPerKilo, 0, 8),
      fix: {
        message:
          numericClaims === 0
            ? "No numeric claims detected. AI engines weight content with concrete statistics over generic prose."
            : `${numericClaims} numeric claim(s) (${claimsPerKilo.toFixed(1)}/1000 words). Add more — and make sure each cites a source.`,
        effort: "writing",
      },
    },
    {
      id: "geo.expert-quote",
      points: 10,
      earned: hasExpertQuote(body.raw) ? 1 : 0,
      fix: {
        message:
          "No expert quote detected. Add a quoted passage from a named source — quotes feed the JSON-LD `Person` chain and improve attribution.",
        effort: "writing",
      },
    },
    {
      id: "geo.fact-density",
      points: 15,
      earned: clamp01(1 - marketingRatio * 5),
      fix: {
        message:
          marketingRatio > 0.04
            ? `Marketing-language ratio is ${(marketingRatio * 100).toFixed(1)}%. Replace hype words ("revolutionary", "game-changing") with concrete claims.`
            : "",
        effort: "writing",
      },
    },
    {
      id: "geo.freshness-block",
      points: 10,
      earned: post.lastRefreshedAt ? 1 : post.publishedAt ? 0.5 : 0,
      fix: {
        message:
          "No `Updated:` block. The freshness protocol (PRD §6.3) is a measurable retrieval signal — refresh and save.",
        effort: "auto",
      },
    },
    {
      id: "geo.listicle-fit",
      points: 10,
      earned: !wantsListicle || looksListicle ? 1 : 0,
      fix: {
        message:
          "Title promises a list ('best…', 'top…', 'N tips…') but the body has no numbered or bulleted list. Add one or change the title.",
        effort: "writing",
      },
    },
    {
      id: "geo.neutral-tone",
      points: 10,
      earned: clamp01(1 - marketingRatio * 8),
      fix: {
        message:
          "Tone reads as brand-forward marketing copy. GEO favors neutral, factual prose — soften adjectives and let the facts lead.",
        effort: "writing",
      },
    },
  ];

  return runRubric("geo", checks);
}

function citationScore(count: number): number {
  if (count >= 5) return 1;
  if (count >= 3) return 0.85;
  if (count === 2) return 0.55;
  if (count === 1) return 0.3;
  return 0;
}

function hasExpertQuote(raw: string): boolean {
  // A quote is a citation block, a markdown blockquote, or a long
  // double-quoted phrase attributable via "— Name" / "- Name" suffix.
  if (/<Citation\b/i.test(raw)) return true;
  if (/^\s*>\s+["“]/m.test(raw)) return true;
  return /["“][^"”]{40,}["”]\s*[—-]\s*[A-Z]/.test(raw);
}
