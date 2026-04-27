/**
 * Aggregate AI Visibility Score (PRD §5B.2).
 *
 * The aggregate is the *weighted geometric mean* of the six discipline
 * scores. Geometric mean (vs. arithmetic) means a post can't paper over a
 * 0 in one discipline by being excellent in another — every discipline
 * matters. Weights come from the active template's scoring rule: a
 * Glossary weighs AIO heaviest, a Listicle weighs GEO, a Landing Page
 * deprioritizes GEO, and so on.
 *
 * Scores are clamped to [1, 100] before logging to avoid -Infinity when
 * a discipline scores 0; that clamping prevents NaN propagation while
 * still preserving the discipline's punishing effect on the aggregate.
 */
import type {
  AiVisibilityReport,
  DisciplineScore,
  ScoreDiscipline,
  ScoreFix,
  Template,
} from "@blogkit/core/types";
import { scoreAeo } from "./aeo.js";
import { scoreAgentSeo } from "./agent-seo.js";
import { scoreAio } from "./aio.js";
import { type ScoreContext, withBody } from "./context.js";
import { scoreGeo } from "./geo.js";
import { scoreLlmo } from "./llmo.js";
import { scoreSeo } from "./seo.js";
import { clampScore } from "./util.js";
import { scoreVoice } from "./voice.js";

export const DEFAULT_WEIGHTS: Record<ScoreDiscipline, number> = {
  seo: 1,
  aeo: 1,
  geo: 1,
  aio: 1,
  llmo: 1,
  agentSeo: 1,
  // Voice contributes 0 by default. Sites with an active voice guide
  // override this to 0.5–1 in their template/site config.
  voice: 0,
};

export function scoreAll(ctx: ScoreContext): Record<ScoreDiscipline, DisciplineScore> {
  const prepared = withBody(ctx);
  return {
    seo: scoreSeo(prepared),
    aeo: scoreAeo(prepared),
    geo: scoreGeo(prepared),
    aio: scoreAio(prepared),
    llmo: scoreLlmo(prepared),
    agentSeo: scoreAgentSeo(prepared),
    voice: prepared.voiceGuide
      ? scoreVoice({
          bodyMdx: prepared.post.bodyMdx,
          title: prepared.post.title,
          guide: prepared.voiceGuide,
        })
      : { score: 100, fixes: [] },
  };
}

export function buildVisibilityReport(ctx: ScoreContext): AiVisibilityReport {
  const scores = scoreAll(ctx);
  const weights = resolveWeights(ctx.template);
  const aggregate = weightedGeoMean(scores, weights);

  const allFixes: ScoreFix[] = [];
  for (const discipline of Object.keys(scores) as ScoreDiscipline[]) {
    for (const fix of scores[discipline].fixes) allFixes.push(fix);
  }
  allFixes.sort((a, b) => b.pointsImpact - a.pointsImpact);

  return {
    postId: ctx.post.id,
    templateId: ctx.post.templateId,
    scores,
    aggregate,
    fixes: allFixes,
    generatedAt: new Date().toISOString(),
  };
}

export function weightedGeoMean(
  scores: Record<ScoreDiscipline, DisciplineScore>,
  weights: Record<ScoreDiscipline, number>,
): number {
  let weightSum = 0;
  let logSum = 0;
  for (const discipline of Object.keys(scores) as ScoreDiscipline[]) {
    const w = Math.max(0, weights[discipline] ?? 1);
    if (w === 0) continue;
    const s = Math.max(1, Math.min(100, scores[discipline].score));
    weightSum += w;
    logSum += w * Math.log(s);
  }
  if (weightSum === 0) return 0;
  return clampScore(Math.exp(logSum / weightSum));
}

export function resolveWeights(template?: Template): Record<ScoreDiscipline, number> {
  const fromTemplate = template?.scoringRules as
    | { weights?: Partial<Record<ScoreDiscipline, number>> }
    | undefined;
  const w = fromTemplate?.weights ?? {};
  return {
    seo: w.seo ?? DEFAULT_WEIGHTS.seo,
    aeo: w.aeo ?? DEFAULT_WEIGHTS.aeo,
    geo: w.geo ?? DEFAULT_WEIGHTS.geo,
    aio: w.aio ?? DEFAULT_WEIGHTS.aio,
    llmo: w.llmo ?? DEFAULT_WEIGHTS.llmo,
    agentSeo: w.agentSeo ?? DEFAULT_WEIGHTS.agentSeo,
    voice: w.voice ?? DEFAULT_WEIGHTS.voice,
  };
}
