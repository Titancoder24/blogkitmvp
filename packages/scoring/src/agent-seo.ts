/**
 * Agent-SEO scorer (PRD §5B.1, §6.7). The newest discipline: grades how
 * machine-actionable the post is to an LLM agent operating through MCP.
 * Touch-points: MCP exposure, sameAs entity grounding, machine-readable
 * summary (TLDR), valid JSON-LD, action-able body structure (steps for
 * how-tos, ratings for reviews), and the ai-plugin manifest.
 */
import type { DisciplineScore, TemplateId } from "@blogkit/core/types";
import { type ScoreContext, withBody } from "./context.js";
import { type Check, runRubric } from "./util.js";

const ACTIONABLE_TEMPLATES: ReadonlySet<TemplateId> = new Set([
  "how-to",
  "recipe",
  "review",
  "comparison",
  "product",
]);

export function scoreAgentSeo(rawCtx: ScoreContext): DisciplineScore {
  const ctx = withBody(rawCtx);
  const { post, site, body } = ctx;
  const sameAsCount = site.organization.sameAs.length;
  const wantsActionable = ACTIONABLE_TEMPLATES.has(post.templateId);
  const looksActionable = wantsActionable
    ? /^\s*\d+\.\s/m.test(body.raw) || /^\s*-\s+/m.test(body.raw)
    : true;

  const checks: Check[] = [
    {
      id: "agent.mcp-exposed",
      points: 25,
      earned: site.mcpEnabled ? 1 : 0,
      fix: {
        message:
          "MCP server not mounted. Set `mcp.enabled: true` in blogkit.config.ts so agents can read and update content.",
        effort: "config",
      },
    },
    {
      id: "agent.sameAs",
      points: 15,
      earned: sameAsCount >= 2 ? 1 : sameAsCount === 1 ? 0.5 : 0,
      fix: {
        message:
          "Add ≥ 2 sameAs URLs to your Organization (Wikidata, LinkedIn, GitHub). Agents use these to confirm brand identity during fan-out queries.",
        effort: "config",
      },
    },
    {
      id: "agent.tldr",
      points: 15,
      earned: post.tldr && post.tldr.trim().length > 0 ? 1 : 0,
      fix: {
        message:
          "No TLDR. Agents prefer a 2-sentence machine-readable summary over re-reading the body.",
        effort: "writing",
      },
    },
    {
      id: "agent.jsonld",
      points: 15,
      earned: post.schemaType ? 1 : 0,
      fix: {
        message:
          "Schema type missing. JSON-LD is the agent's primary structured-data interface — set the type in post settings.",
        effort: "config",
      },
    },
    {
      id: "agent.actionable",
      points: 15,
      earned: looksActionable ? 1 : 0,
      fix: {
        message:
          "This template (How-To, Recipe, Review, Comparison, Product) should expose ordered steps or a comparable list. Add structure an agent can follow.",
        effort: "writing",
      },
    },
    {
      id: "agent.ai-plugin",
      points: 15,
      earned: site.aiPluginManifest ? 1 : 0,
      fix: {
        message:
          "/.well-known/ai-plugin.json is not served. Enable the manifest in the framework adapter so agents using the OpenAPI plugin protocol can discover the site.",
        effort: "config",
      },
    },
  ];

  return runRubric("agentSeo", checks);
}
