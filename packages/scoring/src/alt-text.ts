/**
 * Image alt-text auto-suggestion.
 *
 * Pluggable model interface plus a heuristic fallback. The framework
 * adapter supplies a `VisionModel` implementation (Anthropic vision,
 * OpenAI vision, local model); this module never makes network calls
 * directly, so the package stays pure-function and testable.
 *
 * The fallback uses filename heuristics, post context, and OCR-light
 * detection (keywords from the surrounding paragraph) to produce
 * something better than nothing — useful when no vision model is
 * configured but the writer still wants a starting point.
 */

export interface VisionModel {
  /** Identifier used in audit logs and the dashboard. */
  id: string;
  /**
   * Generate alt text for the image at `imageUrl`. The provided
   * `context` is the surrounding paragraph + post title — vision
   * models that accept text guidance produce much better alt text
   * with this hint.
   */
  describe(input: VisionModelInput): Promise<VisionModelOutput>;
}

export interface VisionModelInput {
  imageUrl: string;
  /** Surrounding paragraph + post title, used as a hint. */
  context: string;
  /** Maximum characters in the returned alt text. Default 125. */
  maxChars?: number;
}

export interface VisionModelOutput {
  /** Suggested alt text. */
  altText: string;
  /** 0–1 confidence the model attaches to the suggestion. */
  confidence: number;
  /** Optional caption (longer than alt text). */
  caption?: string;
}

export interface SuggestAltTextInput {
  imageUrl: string;
  context: string;
  /** Optional vision model. Falls back to heuristic suggestion when null. */
  model?: VisionModel;
  maxChars?: number;
}

export interface SuggestAltTextResult {
  altText: string;
  confidence: number;
  source: "model" | "heuristic";
  modelId?: string;
  caption?: string;
}

export async function suggestAltText(
  input: SuggestAltTextInput,
): Promise<SuggestAltTextResult> {
  const maxChars = input.maxChars ?? 125;

  if (input.model) {
    try {
      const out = await input.model.describe({
        imageUrl: input.imageUrl,
        context: input.context,
        maxChars,
      });
      return {
        altText: trimToChars(out.altText, maxChars),
        confidence: clamp01(out.confidence),
        source: "model",
        modelId: input.model.id,
        caption: out.caption,
      };
    } catch {
      // Fall through to heuristic on model failure.
    }
  }

  const heuristic = heuristicAltText(input);
  return {
    altText: trimToChars(heuristic, maxChars),
    confidence: 0.35,
    source: "heuristic",
  };
}

/**
 * Heuristic alt text: derive a reasonable string from the image
 * filename plus the surrounding context. Better than empty alt text;
 * worse than a vision model. The editor surfaces the source so the
 * writer can see whether to trust it.
 */
function heuristicAltText(input: SuggestAltTextInput): string {
  const filename = filenameOf(input.imageUrl);
  const fromFile = humanizeFilename(filename);
  const fromContext = leadNoun(input.context);

  if (fromContext && fromFile) {
    return `${capitalize(fromContext)} — ${fromFile}`;
  }
  if (fromContext) return capitalize(fromContext);
  if (fromFile) return fromFile;
  return "Image";
}

function filenameOf(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname.split("/").pop() ?? "";
  } catch {
    return url.split("/").pop() ?? "";
  }
}

function humanizeFilename(name: string): string {
  const stem = name.replace(/\.[a-z0-9]{2,5}$/i, "");
  const cleaned = stem
    .replace(/[_-]+/g, " ")
    .replace(/\b(\d{2,4})\b/g, "")
    .trim();
  if (cleaned.length === 0) return "";
  if (cleaned.length > 80) return cleaned.slice(0, 80);
  return cleaned;
}

const NOUN_HINT_RE = /\b(showing|shows|depicts|illustrates|featuring|with)\s+(?:a |an |the )?([\w\s,]{3,40})/i;

/**
 * Pick a likely noun phrase from the surrounding context. Greedy and
 * approximate — the goal is "something better than nothing", not full
 * NLP.
 */
function leadNoun(context: string): string | null {
  if (!context) return null;
  const m = NOUN_HINT_RE.exec(context);
  if (m && m[2]) return m[2].trim();

  // Fallback: first noun-shaped word in the first sentence.
  const firstSentence = context.split(/[.!?]/)[0] ?? "";
  const tokens = firstSentence.match(/\b[A-Za-z][a-z]{3,}\b/g) ?? [];
  for (const token of tokens) {
    if (!STOPWORDS.has(token.toLowerCase())) return token.toLowerCase();
  }
  return null;
}

const STOPWORDS = new Set([
  "this", "that", "these", "those", "with", "from", "into", "above", "below",
  "after", "before", "while", "where", "which", "their", "there", "about",
]);

function trimToChars(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

// ---------- batch ----------
/**
 * Suggest alt text for every image referenced in a post body. The
 * editor's "auto-fill alt text" button walks the result list and pre-
 * fills any image whose alt is currently empty.
 */
export interface BatchAltTextInput {
  bodyMdx: string;
  /** Map of image URL → surrounding paragraph for context. */
  contextByUrl: ReadonlyMap<string, string>;
  model?: VisionModel;
  maxChars?: number;
}

export async function suggestAltTextBatch(
  input: BatchAltTextInput,
): Promise<Map<string, SuggestAltTextResult>> {
  const out = new Map<string, SuggestAltTextResult>();
  const images = extractImageUrls(input.bodyMdx);
  for (const url of images) {
    const context = input.contextByUrl.get(url) ?? "";
    const result = await suggestAltText({
      imageUrl: url,
      context,
      model: input.model,
      maxChars: input.maxChars,
    });
    out.set(url, result);
  }
  return out;
}

function extractImageUrls(body: string): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  const re = /!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const url = m[1] ?? "";
    if (url && !seen.has(url)) {
      seen.add(url);
      urls.push(url);
    }
  }
  return urls;
}
