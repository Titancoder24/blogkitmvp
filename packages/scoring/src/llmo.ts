/**
 * LLM SEO scorer (PRD §5B.1, §6.4). Verifies the access-layer prereqs
 * AI crawlers actually need: SSR/SSG, allow-listed user agents in
 * robots.txt, and an llms.txt entry. The other disciplines are wasted
 * effort if the crawler can't reach the page.
 */
import type { DisciplineScore } from "@blogkit/core/types";
import { type ScoreContext, withBody } from "./context.js";
import { type Check, runRubric } from "./util.js";

export function scoreLlmo(rawCtx: ScoreContext): DisciplineScore {
  const ctx = withBody(rawCtx);
  const { post, body, site } = ctx;
  const headingCount = body.headings.length;

  const checks: Check[] = [
    {
      id: "llmo.ssr",
      points: 25,
      earned: site.serverSideRendered ? 1 : 0,
      fix: {
        message:
          "Server-side rendering not detected. AI crawlers do not execute JavaScript — content must be in the initial HTML response.",
        effort: "config",
      },
    },
    {
      id: "llmo.robots-allows-ai",
      points: 25,
      earned: site.robotsAllowsAi ? 1 : 0,
      fix: {
        message:
          "robots.txt blocks one or more AI user agents. Set `ai.allowedCrawlers: 'all'` in blogkit.config.ts and republish.",
        effort: "config",
      },
    },
    {
      id: "llmo.llms-txt",
      points: 15,
      earned: post.status === "published" ? 1 : 0.5,
      fix: {
        message:
          "Post is not published, so it won't appear in /llms.txt yet. Publish to add it to the llms.txt index.",
        effort: "config",
      },
    },
    {
      id: "llmo.no-paywall",
      points: 10,
      earned: post.noindex ? 0 : 1,
      fix: {
        message: "Post is noindex, which AI crawlers respect for training and search.",
        effort: "config",
      },
    },
    {
      id: "llmo.headings",
      points: 10,
      earned: headingCount >= 2 ? 1 : headingCount === 1 ? 0.5 : 0,
      fix: {
        message:
          headingCount === 0
            ? "No subheadings. AI parsers extract sections by H2/H3 — add at least 2."
            : "Only one heading. Add more H2s so retrieval pipelines can chunk the post into citable sections.",
        effort: "writing",
      },
    },
    {
      id: "llmo.canonical",
      points: 5,
      earned: post.canonicalUrl || post.slug ? 1 : 0,
      fix: {
        message: "No canonical URL. AI crawlers dedupe by canonical — set one to avoid duplicate ingest.",
        effort: "config",
      },
    },
    {
      id: "llmo.published",
      points: 10,
      earned: post.status === "published" ? 1 : 0,
      fix: {
        message: "Draft is not yet public. AI crawlers can only fetch published posts.",
        effort: "config",
      },
    },
  ];

  return runRubric("llmo", checks);
}
