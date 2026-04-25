/**
 * Classical SEO scorer (PRD §5B.1, §6.1). Targets a 95+ Lighthouse SEO
 * score on every published post.
 */
import type { DisciplineScore } from "@blogkit/core/types";
import { type ScoreContext, withBody } from "./context.js";
import { type Check, band, lerp, runRubric } from "./util.js";

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function scoreSeo(rawCtx: ScoreContext): DisciplineScore {
  const ctx = withBody(rawCtx);
  const { post, body } = ctx;
  const titleLen = post.title.length;
  const metaLen = (post.customMetaDescription ?? post.excerpt ?? "").length;
  const altCovered = countImageAltCoverage(body.raw);
  const headingValid = headingHierarchyValid(body.headings.map((h) => h.level));
  const h1Count = body.headings.filter((h) => h.level === 1).length;

  const checks: Check[] = [
    {
      id: "seo.title-length",
      points: 10,
      earned: band(titleLen, 50, 60, 30, 75),
      fix: {
        message:
          titleLen < 50
            ? `Title is ${titleLen} characters. Aim for 50–60 — Google truncates around 60 and shorter titles get less click-through in search.`
            : titleLen > 60
            ? `Title is ${titleLen} characters. Trim to ≤ 60 to avoid SERP truncation.`
            : "Adjust title to land in the 50–60 char band.",
        effort: "writing",
      },
    },
    {
      id: "seo.meta-description",
      points: 10,
      earned: metaLen === 0 ? 0 : band(metaLen, 120, 160, 50, 200),
      fix: {
        message:
          metaLen === 0
            ? "No meta description. Add a 120–160 char description in the post settings."
            : metaLen < 120
            ? `Meta description is ${metaLen} chars. Aim for 120–160 to maximize SERP real-estate.`
            : `Meta description is ${metaLen} chars. Trim to 160 to avoid truncation.`,
        effort: metaLen === 0 ? "writing" : "auto",
      },
    },
    {
      id: "seo.h1-unique",
      points: 8,
      // The framework renders Post.title as H1 above the body MDX, so
      // 0 H1s in the body is correct. Anything > 1 means the writer
      // duplicated the title heading inside the body.
      earned: h1Count <= 1 ? 1 : 0,
      fix: {
        message: `Found ${h1Count} H1 elements in the body. The post title is rendered as H1 already — remove the duplicate.`,
        effort: "writing",
      },
    },
    {
      id: "seo.heading-hierarchy",
      points: 8,
      earned: headingValid ? 1 : 0,
      fix: {
        message: "Heading hierarchy skips a level. Use H2 → H3 → H4 in order; don't jump from H2 to H4.",
        effort: "writing",
      },
    },
    {
      id: "seo.alt-text",
      points: 10,
      earned: altCovered.total === 0 ? 1 : altCovered.withAlt / altCovered.total,
      fix: {
        message:
          altCovered.total === 0
            ? ""
            : `${altCovered.total - altCovered.withAlt}/${altCovered.total} images have no alt text. Add alt text to every image.`,
        effort: "writing",
      },
    },
    {
      id: "seo.internal-links",
      points: 8,
      earned: body.links.internal >= 1 ? 1 : 0,
      fix: {
        message:
          "No internal links. Link to at least one related post — internal linking is the highest-leverage on-page SEO signal.",
        effort: "writing",
      },
    },
    {
      id: "seo.canonical",
      points: 6,
      earned: post.canonicalUrl || post.slug ? 1 : 0,
      fix: {
        message: "Canonical URL not resolvable. Set a slug or canonical_url override.",
        effort: "config",
      },
    },
    {
      id: "seo.slug-quality",
      points: 6,
      earned: scoreSlug(post.slug),
      fix: {
        message: "Slug is non-canonical. Use lowercase kebab-case, ≤ 80 chars, no stop words.",
        effort: "writing",
      },
    },
    {
      id: "seo.og-image",
      points: 8,
      earned: post.coverImageUrl || post.customOgImage ? 1 : 0,
      fix: {
        message:
          "No cover image / OG image. Add one — social link previews and Twitter Cards both depend on it.",
        effort: "writing",
      },
    },
    {
      id: "seo.word-count",
      points: 8,
      earned: lerp(body.wordCount, 100, 600),
      fix: {
        message:
          body.wordCount < 300
            ? `Post is ${body.wordCount} words. Long-form (600+) ranks materially better.`
            : "",
        effort: "writing",
      },
    },
    {
      id: "seo.reading-time",
      points: 4,
      earned: post.readingTimeMinutes && post.readingTimeMinutes > 0 ? 1 : 0,
      fix: {
        message: "Reading time not computed. The renderer adds it automatically — re-save the post.",
        effort: "auto",
      },
    },
    {
      id: "seo.fresh",
      points: 6,
      earned: freshnessFactor(post.lastRefreshedAt ?? post.publishedAt ?? post.updatedAt),
      fix: {
        message:
          "Post hasn't been refreshed in over 90 days. Update statistics, examples, and citations.",
        effort: "writing",
      },
    },
    {
      id: "seo.noindex",
      points: 8,
      earned: post.noindex ? 0 : 1,
      fix: {
        message: "Post is marked noindex. Search engines will not list it.",
        effort: "config",
      },
    },
  ];

  return runRubric("seo", checks);
}

function scoreSlug(slug: string): number {
  if (!slug) return 0;
  if (slug.length > 80) return 0.5;
  return SLUG_RE.test(slug) ? 1 : 0.3;
}

function countImageAltCoverage(text: string): { total: number; withAlt: number } {
  const matches = text.match(/!\[([^\]]*)\]\([^)]+\)/g) ?? [];
  let withAlt = 0;
  for (const m of matches) {
    const alt = /!\[([^\]]*)\]/.exec(m)?.[1] ?? "";
    if (alt.trim().length > 0) withAlt += 1;
  }
  return { total: matches.length, withAlt };
}

function headingHierarchyValid(levels: readonly number[]): boolean {
  if (levels.length === 0) return true;
  let prev = levels[0] ?? 1;
  for (let i = 1; i < levels.length; i++) {
    const lvl = levels[i] ?? 1;
    if (lvl > prev + 1) return false;
    prev = lvl;
  }
  return true;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function freshnessFactor(timestamp: string | undefined): number {
  if (!timestamp) return 0.5;
  const t = new Date(timestamp).getTime();
  if (!Number.isFinite(t)) return 0.5;
  const ageDays = (Date.now() - t) / DAY_MS;
  if (ageDays <= 30) return 1;
  if (ageDays <= 90) return 0.7;
  if (ageDays <= 180) return 0.4;
  return 0;
}
