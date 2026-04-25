/**
 * Answer Engine Optimization scorer (PRD §5B.1, §6.2). Targets featured-
 * snippet extraction and AI Overviews citation by structuring content as
 * questions with direct, scannable answers.
 */
import type { DisciplineScore } from "@blogkit/core/types";
import { type ScoreContext, withBody } from "./context.js";
import { type Check, lerp, runRubric } from "./util.js";
import { avgParagraphWordCount, isQuestionHeading } from "./text.js";

export function scoreAeo(rawCtx: ScoreContext): DisciplineScore {
  const ctx = withBody(rawCtx);
  const { post, body } = ctx;
  const subheadings = body.headings.filter((h) => h.level === 2 || h.level === 3);
  const questionSubheadings = subheadings.filter(isQuestionHeading).length;
  const directAnswerWordCount = directAnswerWords(body.paragraphs[0] ?? "");
  const faqCount = post.faqJson?.length ?? 0;
  const avgParaWords = avgParagraphWordCount(body.paragraphs);

  const checks: Check[] = [
    {
      id: "aeo.question-headings",
      points: 20,
      earned: lerp(questionSubheadings, 0, 3),
      fix: {
        message:
          questionSubheadings === 0
            ? "No question-format subheadings. Reword H2s as questions ('What is…?', 'How does…work?'). AI Overviews cite question/answer pairs disproportionately."
            : `Only ${questionSubheadings} question-format subheading(s). Aim for 3+ to maximize AEO surface area.`,
        effort: "writing",
      },
    },
    {
      id: "aeo.direct-answer",
      points: 15,
      earned: directAnswerWordCount > 0 && directAnswerWordCount <= 50 ? 1 : 0,
      fix: {
        message:
          directAnswerWordCount === 0
            ? "Open with a direct answer in the first paragraph. AI engines extract the first 40–50 words for snippets."
            : `Opening paragraph is ${directAnswerWordCount} words. Trim to ≤ 50 — featured snippets cap there.`,
        effort: "writing",
      },
    },
    {
      id: "aeo.faq-block",
      points: 20,
      earned: faqCount >= 3 ? 1 : faqCount >= 1 ? 0.5 : 0,
      fix: {
        message:
          faqCount === 0
            ? "No FAQ block. Add 3+ Q/A pairs — FAQ schema is one of the strongest AEO signals."
            : `Only ${faqCount} FAQ pair(s). 3+ unlock the FAQ schema cluster in Google.`,
        effort: "writing",
      },
    },
    {
      id: "aeo.scannable",
      points: 15,
      earned: avgParaWords === 0 ? 0 : avgParaWords <= 80 ? 1 : avgParaWords <= 120 ? 0.6 : 0.2,
      fix: {
        message:
          avgParaWords > 120
            ? `Average paragraph is ${avgParaWords} words. Break long paragraphs in half — AI parsers favor short, atomic chunks.`
            : "",
        effort: "writing",
      },
    },
    {
      id: "aeo.lists",
      points: 10,
      earned: body.hasLists ? 1 : 0,
      fix: {
        message:
          "No bullet or numbered lists. Convert at least one section to a list — listicle-style chunks dominate AI Overviews.",
        effort: "writing",
      },
    },
    {
      id: "aeo.tables",
      points: 10,
      earned: body.hasTable ? 1 : 0.5,
      fix: {
        message:
          "No comparison tables. If your post compares options, add a table — Google extracts table rows directly into rich results.",
        effort: "writing",
      },
    },
    {
      id: "aeo.tldr",
      points: 10,
      earned: post.tldr && post.tldr.trim().length > 0 ? 1 : 0,
      fix: {
        message:
          "No TLDR. Add a 2-sentence summary at the top — it doubles as the meta description and as the LLM-extractable abstract.",
        effort: "writing",
      },
    },
  ];

  return runRubric("aeo", checks);
}

function directAnswerWords(paragraph: string): number {
  if (!paragraph) return 0;
  const matches = paragraph.match(/[A-Za-z0-9'’-]+/g);
  return matches ? matches.length : 0;
}
