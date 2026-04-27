/**
 * Headline A/B scorer.
 *
 * A writer (or an agent) provides multiple headline variants for the
 * same post; this module scores each variant against SEO/AEO/GEO/AIO
 * heuristics and returns a ranking. The publish flow ships the highest-
 * scoring variant; the others persist in `blogkit_headline_variants` so
 * the team can see history.
 *
 * Heuristics scored:
 *   - length band (50–60 chars optimal for SERP)
 *   - keyword frontloading (target keyword in first 35 chars)
 *   - listicle promise alignment (numbered title implies the body)
 *   - power words and curiosity gap (used carefully — too many is hype)
 *   - question-format bonus for AEO
 *   - presence of brand name when the voice guide demands it
 *   - emoji penalty (Google strips them in many SERPs and AI engines
 *     have inconsistent extraction)
 */

import { titleImpliesListicle } from "./text.js";

export interface HeadlineVariant {
  /** Stable id so callers can correlate input ↔ output. */
  id: string;
  text: string;
}

export interface HeadlineScoreInput {
  variant: HeadlineVariant;
  /** Optional target keyword to prioritize. */
  targetKeyword?: string;
  /** Brand name that must appear when the voice guide requires it. */
  requiredBrand?: string;
  /** Body word count — used to validate listicle promise. */
  bodyWordCount?: number;
  /** Body has numbered/bulleted list — corroborates a listicle title. */
  bodyHasList?: boolean;
}

export interface HeadlineScore {
  variantId: string;
  text: string;
  /** Aggregate 0–100 score. Higher is better. */
  score: number;
  /** Per-dimension breakdown for the dashboard's "why we picked this". */
  breakdown: HeadlineBreakdown;
  notes: string[];
}

export interface HeadlineBreakdown {
  length: number;
  keywordFrontload: number;
  listicleAlignment: number;
  powerWords: number;
  questionBonus: number;
  brandPresence: number;
  emojiPenalty: number;
}

const POWER_WORDS = new Set([
  "ultimate",
  "complete",
  "essential",
  "definitive",
  "comprehensive",
  "proven",
  "modern",
  "practical",
  "actionable",
  "fast",
  "free",
  "open-source",
  "agent-native",
  "ai-powered",
  "ai-ready",
]);

const CURIOSITY_HINTS = ["why", "how", "what", "really", "actually", "secret", "hidden"];

const EMOJI_RE =
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{2B00}-\u{2BFF}]/u;

export function scoreHeadline(input: HeadlineScoreInput): HeadlineScore {
  const text = input.variant.text;
  const lower = text.toLowerCase();
  const breakdown: HeadlineBreakdown = {
    length: scoreLength(text.length),
    keywordFrontload: scoreFrontload(lower, input.targetKeyword),
    listicleAlignment: scoreListicleAlignment(text, input),
    powerWords: scorePowerAndCuriosity(lower),
    questionBonus: text.trim().endsWith("?") ? 1 : 0,
    brandPresence: scoreBrand(lower, input.requiredBrand),
    emojiPenalty: EMOJI_RE.test(text) ? -1 : 0,
  };

  const score = composeAggregate(breakdown);
  return {
    variantId: input.variant.id,
    text,
    score,
    breakdown,
    notes: explain(breakdown, text),
  };
}

export interface PickWinnerInput {
  variants: readonly HeadlineVariant[];
  /** Optional target keyword. */
  targetKeyword?: string;
  /** Brand name that must appear when the voice guide requires it. */
  requiredBrand?: string;
  bodyWordCount?: number;
  bodyHasList?: boolean;
}

export interface PickWinnerResult {
  winner: HeadlineScore;
  ranking: HeadlineScore[];
}

export function pickWinner(input: PickWinnerInput): PickWinnerResult {
  if (input.variants.length === 0) {
    throw new Error("pickWinner requires at least one variant");
  }
  const ranking = input.variants
    .map((variant) =>
      scoreHeadline({
        variant,
        targetKeyword: input.targetKeyword,
        requiredBrand: input.requiredBrand,
        bodyWordCount: input.bodyWordCount,
        bodyHasList: input.bodyHasList,
      }),
    )
    .sort((a, b) => b.score - a.score);
  return { winner: ranking[0]!, ranking };
}

// ---------- scoring components ----------
function scoreLength(length: number): number {
  if (length === 0) return 0;
  if (length >= 50 && length <= 60) return 1;
  if (length >= 40 && length < 50) return 0.7;
  if (length > 60 && length <= 70) return 0.6;
  if (length >= 30 && length < 40) return 0.4;
  if (length > 70 && length <= 80) return 0.3;
  return 0.1;
}

function scoreFrontload(lower: string, target: string | undefined): number {
  if (!target) return 0.5;
  const idx = lower.indexOf(target.toLowerCase());
  if (idx === -1) return 0;
  if (idx < 5) return 1;
  if (idx < 15) return 0.8;
  if (idx < 35) return 0.6;
  return 0.3;
}

function scoreListicleAlignment(text: string, input: HeadlineScoreInput): number {
  if (!titleImpliesListicle(text)) return 0.5; // not a listicle: neutral
  // Title implies a list; body should corroborate.
  if (input.bodyHasList) return 1;
  return 0;
}

function scorePowerAndCuriosity(lower: string): number {
  const tokens = lower.match(/[a-z][a-z0-9-]+/g) ?? [];
  let power = 0;
  let curiosity = 0;
  for (const token of tokens) {
    if (POWER_WORDS.has(token)) power += 1;
    if (CURIOSITY_HINTS.includes(token)) curiosity += 1;
  }
  // 1 power word + 1 curiosity is a sweet spot. Beyond that, penalize
  // for hype (GEO doesn't reward marketing-heavy titles).
  const total = power + curiosity;
  if (total === 0) return 0.4;
  if (total <= 2) return 1;
  if (total === 3) return 0.6;
  return 0.2;
}

function scoreBrand(lower: string, brand: string | undefined): number {
  if (!brand) return 0.5;
  return lower.includes(brand.toLowerCase()) ? 1 : 0;
}

function composeAggregate(b: HeadlineBreakdown): number {
  // Weighted sum; weights sum to 100 (with the emoji penalty subtracting up to 5).
  const raw =
    25 * b.length +
    20 * b.keywordFrontload +
    15 * b.listicleAlignment +
    15 * b.powerWords +
    15 * b.questionBonus +
    10 * b.brandPresence +
    5 * b.emojiPenalty;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

function explain(b: HeadlineBreakdown, text: string): string[] {
  const notes: string[] = [];
  const len = text.length;
  if (b.length < 0.7) {
    notes.push(`Length is ${len} chars; aim for 50–60.`);
  }
  if (b.keywordFrontload < 0.5) {
    notes.push("Target keyword isn't front-loaded.");
  }
  if (b.listicleAlignment === 0) {
    notes.push("Title implies a list but the body has no list — mismatch.");
  }
  if (b.powerWords < 0.4) {
    notes.push("Add one power word ('Ultimate', 'Practical', 'Modern') or a curiosity hint ('Why', 'How').");
  }
  if (b.powerWords < 0.4 && b.powerWords > 0) {
    // unreachable — kept for clarity
  } else if (b.powerWords <= 0.2) {
    notes.push("Too many power/curiosity words — reads as marketing copy.");
  }
  if (b.questionBonus === 1) {
    notes.push("Question format — strong for AEO (featured snippets).");
  }
  if (b.brandPresence === 0) {
    notes.push("Brand name not in the headline.");
  }
  if (b.emojiPenalty < 0) {
    notes.push("Emoji detected — Google often strips them in SERPs.");
  }
  return notes;
}
