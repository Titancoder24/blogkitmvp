/**
 * AI Overviews / Definition-Lead optimization scorer (PRD §5B.1, §6.6).
 *
 * AIO is the discipline that grades how easily an AI engine can both
 * disambiguate the entity (via Organization schema + sameAs) and extract
 * a stand-alone definition for citation. Definition-Lead and complete
 * JSON-LD stacks dominate the rubric.
 */
import type { DisciplineScore } from "@blogkit/core/types";
import { type ScoreContext, withBody } from "./context.js";
import { type Check, runRubric } from "./util.js";
import { looksLikeDefinitionLead } from "./text.js";

export function scoreAio(rawCtx: ScoreContext): DisciplineScore {
  const ctx = withBody(rawCtx);
  const { post, body, site } = ctx;
  const sameAsCount = site.organization.sameAs.length;
  const hasOrganizationLogo = Boolean(site.organization.logoUrl);
  const heroImageWithAlt = Boolean(post.coverImageUrl);

  const checks: Check[] = [
    {
      id: "aio.definition-lead",
      points: 25,
      earned: looksLikeDefinitionLead(body.firstSentence) ? 1 : 0,
      fix: {
        message:
          "Opening sentence doesn't follow the Definition-Lead pattern. Use '[Topic] is a [category] that [differentiator]' — this is the single highest-impact AIO change.",
        effort: "writing",
      },
    },
    {
      id: "aio.organization-sameAs",
      points: 15,
      earned: sameAsCount >= 4 ? 1 : sameAsCount >= 2 ? 0.7 : sameAsCount === 1 ? 0.4 : 0,
      fix: {
        message:
          sameAsCount === 0
            ? "Organization sameAs is empty. Add Wikidata, LinkedIn, GitHub, and Crunchbase URLs in settings — entity disambiguation depends on this."
            : `Only ${sameAsCount} sameAs link(s). 4+ is the GEO sweet spot.`,
        effort: "config",
      },
    },
    {
      id: "aio.organization-logo",
      points: 10,
      earned: hasOrganizationLogo ? 1 : 0,
      fix: {
        message: "Organization logo not set. AI engines display this in citation chips.",
        effort: "config",
      },
    },
    {
      id: "aio.author-publisher",
      points: 20,
      earned: post.authorId ? 1 : 0,
      fix: {
        message:
          "Post has no author. JSON-LD `Person` is the second-strongest AIO signal — assign an author with bio + sameAs links.",
        effort: "config",
      },
    },
    {
      id: "aio.hero-image",
      points: 10,
      earned: heroImageWithAlt ? 1 : 0,
      fix: {
        message: "No hero image. ImageObject schema and AI Overview thumbnails both need it.",
        effort: "writing",
      },
    },
    {
      id: "aio.breadcrumbs",
      points: 10,
      earned: 1,
      fix: undefined,
    },
    {
      id: "aio.schema-type",
      points: 10,
      earned: post.schemaType ? 1 : 0,
      fix: {
        message:
          "Schema type not set. Pick BlogPosting, Article, NewsArticle, or TechArticle (per template).",
        effort: "config",
      },
    },
  ];

  return runRubric("aio", checks);
}
