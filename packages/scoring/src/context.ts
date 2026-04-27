/**
 * `ScoreContext` — the input to every discipline scorer.
 *
 * The shape is intentionally narrow: all scorers receive the same context,
 * so the editor can compute every score from a single in-memory snapshot
 * without re-fetching adapter data on every keystroke.
 */
import type {
  Citation,
  OrganizationConfig,
  Post,
  SiteConfig,
  Template,
} from "@blogkit/core/types";
import { type BodyAnalysis, analyzeBody } from "./text.js";
import type { VoiceGuide } from "./voice.js";

export interface ScoreSiteState {
  /** Resolved site config. */
  site: SiteConfig;
  organization: OrganizationConfig;
  /** True when the host site's robots.txt allow-lists AI crawlers. */
  robotsAllowsAi: boolean;
  /** True when MCP is mounted (PRD §6.7). */
  mcpEnabled: boolean;
  /** True when /.well-known/ai-plugin.json is served. */
  aiPluginManifest: boolean;
  /** True when the host runs SSR/SSG (no JS-only content). */
  serverSideRendered: boolean;
}

export interface ScoreContext {
  post: Post;
  citations: readonly Citation[];
  template?: Template;
  site: ScoreSiteState;
  /** Optional pre-computed body analysis; avoids redundant work. */
  body?: BodyAnalysis;
  /**
   * Active voice guide. When undefined, the voice scorer returns 100
   * with no fixes (so absence of a guide doesn't depress the aggregate).
   */
  voiceGuide?: VoiceGuide;
}

export function withBody(ctx: ScoreContext): Required<Pick<ScoreContext, "body">> &
  ScoreContext {
  if (ctx.body) return ctx as Required<Pick<ScoreContext, "body">> & ScoreContext;
  return {
    ...ctx,
    body: analyzeBody(ctx.post.bodyMdx, { siteUrl: ctx.site.site.url }),
  };
}
