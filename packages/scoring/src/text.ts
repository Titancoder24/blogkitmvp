/**
 * Lightweight text extraction over MDX/markdown bodies.
 *
 * The scoring engine grades posts in real time as a writer types, so the
 * extractors here have to be cheap, allocation-light, and tolerant of
 * partially-formed input. They are heuristic on purpose — full MDX parsing
 * via unified/micromark is overkill for the questions we're answering
 * ("how many H2s?", "what's the first sentence?", "are there bullets?").
 *
 * Edge cases handled:
 *   - frontmatter (YAML between leading `---` markers) is stripped.
 *   - fenced code blocks are removed before counting words and headings.
 *   - JSX/MDX block components are tolerated; closing tags are stripped.
 */

export interface Heading {
  level: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
}

export interface LinkCounts {
  internal: number;
  external: number;
}

export interface BodyAnalysis {
  raw: string;
  /** With frontmatter, code fences, and HTML/JSX tags removed. */
  clean: string;
  wordCount: number;
  headings: Heading[];
  paragraphs: string[];
  /** First sentence in the first paragraph (used by Definition-Lead check). */
  firstSentence: string;
  links: LinkCounts;
  /** True if any bullet (`- ` / `* `) or numbered list (`1. `) line exists. */
  hasLists: boolean;
  /** True if a markdown table (`|---|`) appears. */
  hasTable: boolean;
  /** True if a blockquote (`>`) line appears outside of citation blocks. */
  hasBlockquote: boolean;
}

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*\n/;
const CODE_FENCE_RE = /```[\s\S]*?```/g;
const INLINE_CODE_RE = /`[^`]*`/g;
const HTML_TAG_RE = /<\/?[a-zA-Z][\w-]*[^>]*\/?>/g;
const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/gm;
const PARAGRAPH_SPLIT_RE = /\n{2,}/;
const SENTENCE_RE = /[^.!?]+[.!?]+/;
const LIST_RE = /^\s*(?:[-*]\s+|\d+\.\s+)/m;
const TABLE_RE = /^\s*\|.*\|\s*$/m;
const BLOCKQUOTE_RE = /^\s*>\s+/m;

export function analyzeBody(raw: string, opts: { siteUrl?: string } = {}): BodyAnalysis {
  const stripped = raw.replace(FRONTMATTER_RE, "");
  const noCode = stripped.replace(CODE_FENCE_RE, "").replace(INLINE_CODE_RE, "");
  const clean = noCode.replace(HTML_TAG_RE, "").trim();

  return {
    raw,
    clean,
    wordCount: countWords(clean),
    headings: extractHeadings(noCode),
    paragraphs: splitParagraphs(clean),
    firstSentence: firstSentenceOf(clean),
    links: countLinks(noCode, opts.siteUrl),
    hasLists: LIST_RE.test(noCode),
    hasTable: TABLE_RE.test(noCode),
    hasBlockquote: BLOCKQUOTE_RE.test(noCode),
  };
}

export function countWords(text: string): number {
  if (!text) return 0;
  const matches = text.match(/[A-Za-z0-9'’-]+/g);
  return matches ? matches.length : 0;
}

export function extractHeadings(text: string): Heading[] {
  const out: Heading[] = [];
  HEADING_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = HEADING_RE.exec(text)) !== null) {
    const hashes = m[1] ?? "";
    const body = (m[2] ?? "").trim();
    const level = Math.min(6, Math.max(1, hashes.length)) as Heading["level"];
    if (body) out.push({ level, text: body });
  }
  return out;
}

export function splitParagraphs(text: string): string[] {
  return text
    .split(PARAGRAPH_SPLIT_RE)
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && !p.startsWith("#"));
}

export function firstSentenceOf(text: string): string {
  const paragraphs = splitParagraphs(text);
  const first = paragraphs[0];
  if (!first) return "";
  const m = SENTENCE_RE.exec(first);
  return m ? m[0].trim() : first.trim();
}

export function countLinks(text: string, siteUrl?: string): LinkCounts {
  const out: LinkCounts = { internal: 0, external: 0 };
  const linkRe = /\[[^\]]+\]\(([^)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(text)) !== null) {
    const href = m[1] ?? "";
    if (isExternal(href, siteUrl)) out.external += 1;
    else out.internal += 1;
  }
  return out;
}

function isExternal(href: string, siteUrl?: string): boolean {
  if (!/^https?:\/\//i.test(href)) return false;
  if (!siteUrl) return true;
  try {
    const linkHost = new URL(href).host.toLowerCase();
    const siteHost = new URL(siteUrl).host.toLowerCase();
    return linkHost !== siteHost;
  } catch {
    return true;
  }
}

/**
 * "What is X?" / "How does Y work?" / "Why does Z matter?" — the AEO
 * preferred subheading shape.
 */
export function isQuestionHeading(heading: Heading): boolean {
  const t = heading.text.trim().toLowerCase();
  if (t.endsWith("?")) return true;
  return /^(what|why|how|when|where|who|which|can|should|is|are|do|does)\b/.test(
    t,
  );
}

export function avgParagraphWordCount(paragraphs: readonly string[]): number {
  if (paragraphs.length === 0) return 0;
  const total = paragraphs.reduce((sum, p) => sum + countWords(p), 0);
  return Math.round(total / paragraphs.length);
}

/**
 * The Definition-Lead pattern: `[Topic] is a [category] that [differentiator]`.
 * Heuristic match: first sentence contains a copula (`is`, `are`, `means`)
 * within the first 6 words and is shorter than ~30 words.
 */
export function looksLikeDefinitionLead(sentence: string): boolean {
  if (!sentence) return false;
  const words = sentence.split(/\s+/);
  if (words.length === 0 || words.length > 30) return false;
  const head = words.slice(0, 6).join(" ").toLowerCase();
  return /\b(is|are|means|refers to)\b/.test(head);
}

/**
 * Marketing-language detector. A simple lexicon-based ratio — not perfect,
 * but good enough to flag posts that are wall-to-wall hype, which is what
 * the GEO discipline penalizes (PRD §6.3, §5B.1).
 */
const MARKETING_WORDS = new Set([
  "amazing",
  "revolutionary",
  "game-changing",
  "game-changer",
  "best-in-class",
  "world-class",
  "cutting-edge",
  "next-generation",
  "next-gen",
  "unparalleled",
  "leverage",
  "unleash",
  "supercharge",
  "10x",
  "synergy",
  "synergies",
  "disrupt",
  "disruptive",
  "seamless",
  "seamlessly",
  "effortless",
  "effortlessly",
  "robust",
  "powerful",
  "ultimate",
  "incredible",
  "unbelievable",
]);

export function marketingLanguageRatio(text: string): number {
  const words = text.toLowerCase().match(/[a-z][a-z0-9-]+/g) ?? [];
  if (words.length === 0) return 0;
  let hits = 0;
  for (const w of words) if (MARKETING_WORDS.has(w)) hits += 1;
  return hits / words.length;
}

/**
 * Title cues that imply a listicle ("Best X", "Top N Y", "N Things…").
 * Used by GEO to enforce list structure when the title promises one.
 */
export function titleImpliesListicle(title: string): boolean {
  const t = title.trim().toLowerCase();
  return (
    /^(best|top)\s+\d+/i.test(t) ||
    /^(best|top)\b/i.test(t) ||
    /^\d+\s+(things|ways|tips|reasons|tools|examples|ideas|mistakes|tricks)/i.test(
      t,
    ) ||
    /\b(vs\.?|versus)\b/i.test(t)
  );
}

/**
 * Counts numeric claims (percentages, "5,000 X", years like "in 2026") in
 * the text. Used by GEO for fact-density scoring.
 */
export function countNumericClaims(text: string): number {
  const matches = text.match(/\b\d[\d,]*(?:\.\d+)?%?\b/g);
  return matches ? matches.length : 0;
}

/**
 * Rough reading time at 240 wpm (the median for English long-form). Used
 * by the editor and exposed as `Post.readingTimeMinutes`.
 */
export function estimateReadingTimeMinutes(wordCount: number): number {
  return Math.max(1, Math.round(wordCount / 240));
}
