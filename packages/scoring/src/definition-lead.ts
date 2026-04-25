/**
 * Definition-Lead enforcement (PRD §5.2, §5B.1).
 *
 * The Definition-Lead pattern — `[Topic] is a [category] that [differentiator]`
 * in the first sentence — is the single highest-impact AIO change. The
 * editor places a structured placeholder when a writer creates a post,
 * detects whether the active first sentence still matches the pattern,
 * and produces a one-click rewrite suggestion when it doesn't.
 *
 * Everything here is pure-function so the editor can run it on every
 * keystroke without I/O.
 */
import { analyzeBody, looksLikeDefinitionLead } from "./text.js";

export interface DefinitionLeadResult {
  /** True if the first sentence already matches the pattern. */
  passes: boolean;
  /** The detected first sentence (may be empty). */
  firstSentence: string;
  /** The placeholder a fresh post starts with. */
  placeholder: string;
  /** A rewrite suggestion derived from the existing first sentence. */
  suggestion: string | null;
  /**
   * Reason this sentence fails the pattern. Useful for rendering a
   * targeted hint in the editor.
   */
  reason: DefinitionLeadFailureReason | null;
}

export type DefinitionLeadFailureReason =
  | "empty"
  | "no-copula"
  | "too-long"
  | "wrong-structure";

/**
 * Inserted into a fresh post body so the first thing the writer sees is
 * a Definition-Lead skeleton with bracketed slots they can fill in.
 */
export function definitionLeadPlaceholder(topic = "[Topic]"): string {
  return `${topic} is a [category] that [differentiator that matters to your reader].`;
}

/**
 * Rewrite a non-conforming first sentence into the canonical pattern.
 * The function falls back to the placeholder when the input is empty
 * or unsalvageable.
 */
export function suggestDefinitionLead(
  firstSentence: string,
  topic?: string,
): string | null {
  const cleaned = firstSentence.trim();
  if (!cleaned) return null;

  // Try to lift a topic from the existing sentence if not provided.
  const inferred = topic ?? inferTopic(cleaned);
  if (!inferred) return null;

  // Pull the rest of the sentence after the topic so we don't drop it.
  const remainder = stripLeadingTopic(cleaned, inferred);
  const tail = remainder
    ? remainder.replace(/^[,\s—-]*/, "").replace(/\.+$/, "")
    : "";
  if (tail.length === 0) {
    return `${inferred} is a [category] that [differentiator].`;
  }
  return `${inferred} is a [category] that ${tail}.`;
}

export function evaluateDefinitionLead(
  bodyMdx: string,
  opts: { topic?: string } = {},
): DefinitionLeadResult {
  const body = analyzeBody(bodyMdx);
  const firstSentence = body.firstSentence;
  const placeholder = definitionLeadPlaceholder(opts.topic);

  if (!firstSentence) {
    return {
      passes: false,
      firstSentence,
      placeholder,
      suggestion: placeholder,
      reason: "empty",
    };
  }

  if (looksLikeDefinitionLead(firstSentence)) {
    return {
      passes: true,
      firstSentence,
      placeholder,
      suggestion: null,
      reason: null,
    };
  }

  const reason = diagnoseFailure(firstSentence);
  return {
    passes: false,
    firstSentence,
    placeholder,
    suggestion: suggestDefinitionLead(firstSentence, opts.topic),
    reason,
  };
}

function diagnoseFailure(sentence: string): DefinitionLeadFailureReason {
  const words = sentence.split(/\s+/).filter(Boolean);
  if (words.length === 0) return "empty";
  if (words.length > 30) return "too-long";
  const head = words.slice(0, 6).join(" ").toLowerCase();
  if (!/\b(is|are|means|refers to)\b/.test(head)) return "no-copula";
  return "wrong-structure";
}

function inferTopic(sentence: string): string | null {
  // Take the proper-noun or capitalized run that opens the sentence.
  const m = /^([A-Z][\w-]*(?:\s+[A-Z][\w-]*){0,3})/.exec(sentence);
  if (m) return m[1] ?? null;
  // Fallback: the first 1–3 words.
  const words = sentence.split(/\s+/).slice(0, 3);
  return words.length > 0 ? words.join(" ") : null;
}

function stripLeadingTopic(sentence: string, topic: string): string {
  const re = new RegExp(`^${escapeRegex(topic)}\\b`, "i");
  return sentence.replace(re, "").trim();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
