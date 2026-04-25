/**
 * `View-as-ChatGPT` and `View-as-Googlebot` extractors (PRD §5A.4).
 *
 * The editor's preview pane has three modes: "Visitor" (default,
 * pixel-accurate render), "Googlebot" (semantic structure with crawler-
 * relevant overlays), and "ChatGPT" (the structured representation an
 * AI retrieval pipeline would build).
 *
 * The Visitor preview is a normal React render — that lives in the
 * editor package. Googlebot and ChatGPT views are pure data: an
 * extractor turns a Post into a structured shape, and the renderer just
 * displays it. Pure functions also mean the output is testable and
 * exposable through the MCP `get_seo_report` tool so an agent can
 * "see what an AI would extract" without spinning up a browser.
 */
import type { Citation, FAQItem, Post } from "@blogkit/core/types";
import { type BodyAnalysis, analyzeBody, countNumericClaims, looksLikeDefinitionLead } from "./text.js";

// ---------- ChatGPT view ----------
export interface LlmExtraction {
  /** What an LLM treats as the canonical answer. */
  definitionLead: string;
  /** Whether the lead matches the expected pattern. */
  definitionLeadValid: boolean;
  /** Exposed sections in order; each retains its question/heading. */
  sections: LlmSection[];
  /** TLDR or first-paragraph summary. */
  tldr: string | null;
  /** FAQ pairs — these get the highest extraction weight. */
  faqs: FAQItem[];
  /** Concrete numeric claims, ordered by appearance. */
  statistics: Statistic[];
  /** Citation chain — each maps 1:1 to a JSON-LD citation entry. */
  citations: ExtractedCitation[];
  /** Quick metadata an LLM uses for grounding. */
  meta: {
    title: string;
    publishedAt: string | null;
    lastRefreshedAt: string | null;
    author: string | null;
    canonicalUrl: string | null;
    template: string;
  };
}

export interface LlmSection {
  heading: string;
  level: number;
  /** First sentence — the section's "direct answer". */
  directAnswer: string;
  /** Body of the section after the heading, before the next heading. */
  body: string;
}

export interface Statistic {
  /** The numeric token as it appears in the body. */
  claim: string;
  /** Up to ~80 chars surrounding text for context. */
  context: string;
  /** True if a citation appears in the same paragraph. */
  hasNearbySource: boolean;
}

export interface ExtractedCitation {
  url: string;
  title?: string;
  author?: string;
  publishedAt?: string;
  excerpt?: string;
}

export interface ExtractForChatGptInput {
  post: Post;
  citations?: readonly Citation[];
  authorName?: string;
}

export function extractForChatGpt(input: ExtractForChatGptInput): LlmExtraction {
  const { post, citations = [], authorName } = input;
  const body = analyzeBody(post.bodyMdx);

  const definitionLead = body.firstSentence;
  const sections = extractSections(body);
  const statistics = extractStatistics(body);

  return {
    definitionLead,
    definitionLeadValid: looksLikeDefinitionLead(definitionLead),
    sections,
    tldr: post.tldr ?? null,
    faqs: post.faqJson ?? [],
    statistics,
    citations: citations.map((c) => ({
      url: c.sourceUrl,
      title: c.sourceTitle,
      author: c.sourceAuthor,
      publishedAt: c.sourcePublishedAt,
      excerpt: c.excerpt,
    })),
    meta: {
      title: post.title,
      publishedAt: post.publishedAt ?? null,
      lastRefreshedAt: post.lastRefreshedAt ?? null,
      author: authorName ?? null,
      canonicalUrl: post.canonicalUrl ?? null,
      template: String(post.templateId),
    },
  };
}

// ---------- Googlebot view ----------
export interface CrawlerExtraction {
  title: string;
  metaDescription: string | null;
  canonical: string | null;
  noindex: boolean;
  /** Heading outline a crawler builds. */
  outline: Array<{ level: number; text: string }>;
  /** Image audit — alt text gaps are crawler-relevant. */
  imageAudit: ImageAuditEntry[];
  /** Link audit — outgoing links plus internal/external split. */
  linkAudit: { internal: number; external: number; anchors: string[] };
  /** OG / Twitter Card preview. */
  socialMeta: SocialPreview;
  /** Issues a crawler-savvy editor would call out. */
  issues: CrawlerIssue[];
}

export interface ImageAuditEntry {
  src: string;
  alt: string | null;
  isMissingAlt: boolean;
}

export interface SocialPreview {
  ogTitle: string;
  ogDescription: string | null;
  ogImage: string | null;
  twitterCardType: "summary" | "summary_large_image";
}

export interface CrawlerIssue {
  /** Stable id so the renderer can dedupe across runs. */
  id: string;
  severity: "warning" | "error";
  message: string;
}

export interface ExtractForGooglebotInput {
  post: Post;
  metaDescriptionFallback?: string;
  /** When set, used to compute the absolute canonical. */
  siteUrl?: string;
}

export function extractForGooglebot(input: ExtractForGooglebotInput): CrawlerExtraction {
  const { post, siteUrl } = input;
  const body = analyzeBody(post.bodyMdx);

  const metaDescription =
    post.customMetaDescription ?? post.excerpt ?? input.metaDescriptionFallback ?? null;
  const canonical =
    post.canonicalUrl ??
    (siteUrl ? `${siteUrl.replace(/\/+$/, "")}/blog/${post.slug}` : null);

  const imageAudit = auditImages(post.bodyMdx);
  const linkAudit = auditLinks(body, siteUrl);
  const issues = collectIssues(post, body, metaDescription, imageAudit);

  return {
    title: post.customMetaTitle ?? post.title,
    metaDescription,
    canonical,
    noindex: post.noindex,
    outline: body.headings.map((h) => ({ level: h.level, text: h.text })),
    imageAudit,
    linkAudit,
    socialMeta: {
      ogTitle: post.customMetaTitle ?? post.title,
      ogDescription: metaDescription,
      ogImage: post.customOgImage ?? post.coverImageUrl ?? null,
      twitterCardType:
        post.customOgImage || post.coverImageUrl ? "summary_large_image" : "summary",
    },
    issues,
  };
}

// ---------- shared extractors ----------
function extractSections(body: BodyAnalysis): LlmSection[] {
  if (body.headings.length === 0) {
    if (body.paragraphs.length === 0) return [];
    const first = body.paragraphs[0] ?? "";
    return [
      {
        heading: "(opening)",
        level: 0,
        directAnswer: firstSentenceOf(first),
        body: body.paragraphs.join("\n\n"),
      },
    ];
  }

  // Walk the clean body line by line, slicing on heading markers.
  const lines = body.clean.split(/\n/);
  const sections: LlmSection[] = [];
  let current: { level: number; heading: string; body: string[] } | null = null;
  for (const line of lines) {
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) {
      if (current) {
        sections.push(toSection(current));
      }
      const level = (m[1] ?? "").length;
      current = { level, heading: (m[2] ?? "").trim(), body: [] };
    } else if (current) {
      current.body.push(line);
    }
  }
  if (current) sections.push(toSection(current));
  return sections;
}

function toSection(input: { level: number; heading: string; body: string[] }): LlmSection {
  const text = input.body.join("\n").trim();
  return {
    heading: input.heading,
    level: input.level,
    directAnswer: firstSentenceOf(text),
    body: text,
  };
}

function firstSentenceOf(text: string): string {
  const trimmed = text.trim();
  const m = /[^.!?]+[.!?]+/.exec(trimmed);
  return m ? m[0].trim() : trimmed.split("\n")[0]?.trim() ?? "";
}

function extractStatistics(body: BodyAnalysis): Statistic[] {
  const count = countNumericClaims(body.clean);
  if (count === 0) return [];
  const out: Statistic[] = [];
  for (const paragraph of body.paragraphs) {
    const re = /\b\d[\d,]*(?:\.\d+)?%?\b/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(paragraph)) !== null) {
      const start = Math.max(0, m.index - 40);
      const end = Math.min(paragraph.length, m.index + (m[0]?.length ?? 0) + 40);
      out.push({
        claim: m[0] ?? "",
        context: paragraph.slice(start, end).trim(),
        hasNearbySource: /\bhttps?:\/\//.test(paragraph) || /\[[^\]]+\]\([^)]+\)/.test(paragraph),
      });
    }
  }
  return out;
}

function auditImages(raw: string): ImageAuditEntry[] {
  const entries: ImageAuditEntry[] = [];
  const re = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const alt = (m[1] ?? "").trim();
    entries.push({
      src: m[2] ?? "",
      alt: alt || null,
      isMissingAlt: alt.length === 0,
    });
  }
  return entries;
}

function auditLinks(
  body: BodyAnalysis,
  siteUrl: string | undefined,
): { internal: number; external: number; anchors: string[] } {
  const anchors: string[] = [];
  const re = /\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body.clean)) !== null) {
    if (m[1]) anchors.push(m[1]);
  }
  return {
    internal: body.links.internal,
    external: body.links.external,
    anchors,
  };
}

function collectIssues(
  post: Post,
  body: BodyAnalysis,
  metaDescription: string | null,
  imageAudit: readonly ImageAuditEntry[],
): CrawlerIssue[] {
  const issues: CrawlerIssue[] = [];
  if (!metaDescription) {
    issues.push({
      id: "meta.missing",
      severity: "warning",
      message: "No meta description. SERP snippets may be auto-generated.",
    });
  } else if (metaDescription.length > 160) {
    issues.push({
      id: "meta.too-long",
      severity: "warning",
      message: `Meta description is ${metaDescription.length} characters; Google truncates at ~160.`,
    });
  }

  if (post.noindex) {
    issues.push({
      id: "robots.noindex",
      severity: "error",
      message: "Post is marked noindex — search engines will not list it.",
    });
  }

  const missingAlt = imageAudit.filter((i) => i.isMissingAlt).length;
  if (missingAlt > 0) {
    issues.push({
      id: "alt.missing",
      severity: "warning",
      message: `${missingAlt} image${missingAlt === 1 ? " has" : "s have"} no alt text.`,
    });
  }

  const h1Count = body.headings.filter((h) => h.level === 1).length;
  if (h1Count > 1) {
    issues.push({
      id: "heading.duplicate-h1",
      severity: "warning",
      message: `Body has ${h1Count} H1 elements; the title is rendered as H1 already.`,
    });
  }

  let prevLevel = 0;
  for (const h of body.headings) {
    if (prevLevel !== 0 && h.level > prevLevel + 1) {
      issues.push({
        id: "heading.skipped-level",
        severity: "warning",
        message: `Heading level jumps from H${prevLevel} to H${h.level}. Use sequential levels.`,
      });
      break;
    }
    prevLevel = h.level;
  }

  return issues;
}
