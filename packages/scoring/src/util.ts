import type { DisciplineScore, ScoreFix } from "@blogkit/core/types";

/**
 * Rubric helper. Each rubric is an ordered list of `Check` entries with a
 * point value, a passing predicate, and a fix message. The runner totals
 * the points the post earns and returns a clamped 0–100 score plus the
 * fix list for any failed checks.
 */
export interface Check {
  /** Stable id used to dedupe fixes across re-renders. */
  id: string;
  /** Maximum points this check contributes when fully passed. */
  points: number;
  /** 0..1 — fraction of the maximum the post earned. */
  earned: number;
  fix?: Omit<ScoreFix, "id" | "pointsImpact" | "discipline"> & {
    /** When omitted, defaults to `points`. */
    pointsImpact?: number;
  };
}

export function runRubric(
  discipline: ScoreFix["discipline"],
  checks: readonly Check[],
): DisciplineScore {
  let earned = 0;
  let max = 0;
  const fixes: ScoreFix[] = [];

  for (const check of checks) {
    max += check.points;
    earned += check.points * clamp01(check.earned);
    if (check.earned < 1 && check.fix) {
      fixes.push({
        id: check.id,
        discipline,
        message: check.fix.message,
        effort: check.fix.effort,
        pointsImpact:
          check.fix.pointsImpact ?? Math.round(check.points * (1 - check.earned)),
      });
    }
  }

  const score = max === 0 ? 100 : (earned / max) * 100;
  return {
    score: clampScore(score),
    fixes: fixes.sort((a, b) => b.pointsImpact - a.pointsImpact),
  };
}

export function clampScore(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/** Linear interpolation: 0 at `floor`, 1 at `ceiling`. */
export function lerp(value: number, floor: number, ceiling: number): number {
  if (ceiling <= floor) return value >= ceiling ? 1 : 0;
  return clamp01((value - floor) / (ceiling - floor));
}

/**
 * "How close is `value` to the [low, high] sweet spot?" — returns 1 inside
 * the range, then linearly decays to 0 at `floor` (below) or `ceiling`
 * (above). Used for things like "title length 50–60 chars."
 */
export function band(
  value: number,
  low: number,
  high: number,
  floor: number,
  ceiling: number,
): number {
  if (value >= low && value <= high) return 1;
  if (value < low) return clamp01((value - floor) / (low - floor));
  return clamp01((ceiling - value) / (ceiling - high));
}
