/**
 * External link health checker.
 *
 * Periodically probes every external URL referenced in the corpus and
 * records its status. The decay dashboard surfaces broken links so a
 * writer can fix them at the next refresh — broken links are a real GEO
 * negative because AI engines distrust pages that link to dead sources.
 *
 * The checker is pure-function over an injectable fetcher. The Supabase
 * adapter wires this to a scheduled job and persists results to
 * `blogkit_link_checks` + `blogkit_post_links`.
 */

export type LinkHealth = "healthy" | "redirect" | "broken" | "timeout" | "unchecked";

export interface LinkProbe {
  url: string;
  status: LinkHealth;
  httpStatus: number | null;
  redirectTarget: string | null;
  /** ms */
  durationMs: number;
}

export type LinkFetcher = (
  url: string,
  init: {
    method: "HEAD" | "GET";
    redirect: "manual";
    headers: Record<string, string>;
    signal?: AbortSignal;
  },
) => Promise<{ status: number; headers: Headers | { get(name: string): string | null } }>;

export interface CheckLinkOptions {
  fetch: LinkFetcher;
  /** Per-URL timeout. Default 8s. */
  timeoutMs?: number;
  /** User agent string. Defaults to a polite identification. */
  userAgent?: string;
}

const DEFAULT_USER_AGENT = "Mozilla/5.0 (compatible; BlogKitLinkChecker/0.1; +https://github.com/titancoder24/blogkitmvp)";

export async function checkLink(
  url: string,
  opts: CheckLinkOptions,
): Promise<LinkProbe> {
  const start = Date.now();
  const controller =
    typeof AbortController !== "undefined" ? new AbortController() : null;
  const timeout = opts.timeoutMs ?? 8_000;
  const timer =
    controller && typeof setTimeout !== "undefined"
      ? setTimeout(() => controller.abort(), timeout)
      : null;

  const headers: Record<string, string> = {
    "user-agent": opts.userAgent ?? DEFAULT_USER_AGENT,
    accept: "*/*",
  };

  try {
    let response = await tryFetch(opts.fetch, url, "HEAD", headers, controller?.signal);
    // Some hosts (notably Cloudflare-fronted ones) return 405 for HEAD.
    // Fall back to GET in that case.
    if (response && (response.status === 405 || response.status === 501)) {
      response = await tryFetch(opts.fetch, url, "GET", headers, controller?.signal);
    }
    if (!response) {
      return makeProbe(url, "broken", null, null, Date.now() - start);
    }

    const target = headerOf(response.headers, "location");

    if (response.status >= 200 && response.status < 300) {
      return makeProbe(url, "healthy", response.status, null, Date.now() - start);
    }
    if (response.status >= 300 && response.status < 400) {
      return makeProbe(url, "redirect", response.status, target, Date.now() - start);
    }
    return makeProbe(url, "broken", response.status, null, Date.now() - start);
  } catch (err) {
    const isAbort = err instanceof Error && err.name === "AbortError";
    return makeProbe(
      url,
      isAbort ? "timeout" : "broken",
      null,
      null,
      Date.now() - start,
    );
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function tryFetch(
  fetcher: LinkFetcher,
  url: string,
  method: "HEAD" | "GET",
  headers: Record<string, string>,
  signal: AbortSignal | undefined,
): Promise<{ status: number; headers: Headers | { get(name: string): string | null } } | null> {
  try {
    return await fetcher(url, { method, redirect: "manual", headers, signal });
  } catch {
    return null;
  }
}

function headerOf(
  headers: Headers | { get(name: string): string | null },
  name: string,
): string | null {
  return headers.get(name);
}

function makeProbe(
  url: string,
  status: LinkHealth,
  httpStatus: number | null,
  redirectTarget: string | null,
  durationMs: number,
): LinkProbe {
  return { url, status, httpStatus, redirectTarget, durationMs };
}

// ---------- batch helpers ----------
export interface BatchOptions {
  /** Concurrent probes. Default 8. */
  concurrency?: number;
  /** Hook for progress reporting. */
  onProbe?: (probe: LinkProbe) => void;
}

/**
 * Probe a list of URLs with bounded concurrency. Returns one
 * `LinkProbe` per input URL (in input order).
 */
export async function checkLinksBatch(
  urls: readonly string[],
  opts: CheckLinkOptions & BatchOptions,
): Promise<LinkProbe[]> {
  const concurrency = Math.max(1, opts.concurrency ?? 8);
  const results: LinkProbe[] = new Array(urls.length);

  // Worker pool: each worker pulls the next index off a shared cursor.
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, urls.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= urls.length) return;
      const url = urls[i] ?? "";
      const probe = await checkLink(url, opts);
      results[i] = probe;
      opts.onProbe?.(probe);
    }
  });
  await Promise.all(workers);
  return results;
}

// ---------- extracting external links from a post body ----------
export interface ExtractedExternalLink {
  url: string;
  /** Best-effort anchor text. */
  anchor?: string;
}

export function extractExternalLinks(
  body: string,
  ownDomains: readonly string[],
): ExtractedExternalLink[] {
  const own = new Set(ownDomains.map((d) => d.toLowerCase().replace(/^www\./, "")));
  const out: ExtractedExternalLink[] = [];
  const seen = new Set<string>();

  const mdRe = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)(?:\s+"[^"]*")?\)/g;
  let m: RegExpExecArray | null;
  while ((m = mdRe.exec(body)) !== null) {
    const url = m[2] ?? "";
    if (!url) continue;
    if (isOwn(url, own)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ url, anchor: m[1] });
  }

  const htmlRe = /<a\b[^>]*\bhref=["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let h: RegExpExecArray | null;
  while ((h = htmlRe.exec(body)) !== null) {
    const url = h[1] ?? "";
    if (!url) continue;
    if (isOwn(url, own)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({
      url,
      anchor: (h[2] ?? "").replace(/<[^>]+>/g, "").trim() || undefined,
    });
  }

  const bareRe = /(?<![\w(])(https?:\/\/[^\s)<\]]+)/g;
  let b: RegExpExecArray | null;
  while ((b = bareRe.exec(body)) !== null) {
    const url = (b[1] ?? "").replace(/[.,;:!?]+$/, "");
    if (!url || isOwn(url, own) || seen.has(url)) continue;
    seen.add(url);
    out.push({ url });
  }

  return out;
}

function isOwn(url: string, own: ReadonlySet<string>): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return own.has(host);
  } catch {
    return false;
  }
}
