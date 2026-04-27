/**
 * Brand voice guide — the 7th scoring discipline.
 *
 * Sites configure a voice guide once (`blogkit_voice_guides`) and the
 * scorer grades every post against it: banned phrases, required phrases,
 * tone-word density, sentence-length band. The aggregate AI Visibility
 * Score includes voice when a guide is active.
 *
 * Pure-function so the editor can run it on every keystroke.
 */
import type { DisciplineScore } from "@blogkit/core/types";
import { analyzeBody } from "./text.js";
import { type Check, runRubric } from "./util.js";

export interface VoiceGuide {
  /** Phrases (case-insensitive) that must NEVER appear. */
  banned: readonly string[];
  /** Phrases that must appear at least once. Useful for brand-name enforcement. */
  required: readonly string[];
  /** Tone words that signal the desired voice. */
  tone: readonly string[];
  minSentenceWords: number;
  maxSentenceWords: number;
}

export const DEFAULT_VOICE_GUIDE: VoiceGuide = {
  banned: [],
  required: [],
  tone: [],
  minSentenceWords: 8,
  maxSentenceWords: 30,
};

export interface ScoreVoiceInput {
  bodyMdx: string;
  title?: string;
  guide: VoiceGuide;
}

export function scoreVoice(input: ScoreVoiceInput): DisciplineScore {
  const haystackText = `${input.title ?? ""}\n${input.bodyMdx}`;
  const haystack = haystackText.toLowerCase();
  const body = analyzeBody(input.bodyMdx);

  const bannedHits = input.guide.banned.filter((phrase) =>
    haystack.includes(phrase.toLowerCase()),
  );
  const missingRequired = input.guide.required.filter(
    (phrase) => !haystack.includes(phrase.toLowerCase()),
  );

  const toneScore = input.guide.tone.length === 0
    ? 1
    : computeToneCoverage(haystack, input.guide.tone);

  const sentences = splitSentences(body.clean);
  const lengthOk = sentenceLengthFraction(
    sentences,
    input.guide.minSentenceWords,
    input.guide.maxSentenceWords,
  );

  const checks: Check[] = [
    {
      id: "voice.banned",
      points: 30,
      earned: bannedHits.length === 0 ? 1 : Math.max(0, 1 - bannedHits.length * 0.34),
      fix: bannedHits.length === 0
        ? undefined
        : {
            message: `Banned phrase${bannedHits.length === 1 ? "" : "s"} detected: ${bannedHits.slice(0, 5).join(", ")}.`,
            effort: "writing",
          },
    },
    {
      id: "voice.required",
      points: 25,
      earned:
        input.guide.required.length === 0
          ? 1
          : (input.guide.required.length - missingRequired.length) /
            input.guide.required.length,
      fix:
        missingRequired.length === 0
          ? undefined
          : {
              message: `Missing required phrase${missingRequired.length === 1 ? "" : "s"}: ${missingRequired.slice(0, 5).join(", ")}.`,
              effort: "writing",
            },
    },
    {
      id: "voice.tone",
      points: 20,
      earned: toneScore,
      fix:
        toneScore >= 1
          ? undefined
          : {
              message: `Tone words from the guide are under-represented. Expected: ${input.guide.tone.slice(0, 5).join(", ")}.`,
              effort: "writing",
            },
    },
    {
      id: "voice.sentence-length",
      points: 25,
      earned: lengthOk,
      fix:
        lengthOk >= 0.85
          ? undefined
          : {
              message: `Sentence length is outside the guide's ${input.guide.minSentenceWords}–${input.guide.maxSentenceWords} word band.`,
              effort: "writing",
            },
    },
  ];

  return runRubric("voice", checks);
}

function computeToneCoverage(haystack: string, tone: readonly string[]): number {
  if (tone.length === 0) return 1;
  let hits = 0;
  for (const word of tone) {
    if (haystack.includes(word.toLowerCase())) hits += 1;
  }
  // Reward at least half coverage; full score at full coverage.
  return Math.max(0, Math.min(1, (hits / tone.length) * 1.5));
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith("#"));
}

function sentenceLengthFraction(
  sentences: readonly string[],
  min: number,
  max: number,
): number {
  if (sentences.length === 0) return 1;
  let inBand = 0;
  for (const s of sentences) {
    const words = (s.match(/[A-Za-z0-9'’-]+/g) ?? []).length;
    if (words >= min && words <= max) inBand += 1;
  }
  return inBand / sentences.length;
}
