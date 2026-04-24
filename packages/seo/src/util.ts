/**
 * Shared XML / URL helpers. Kept tiny on purpose — no dependencies.
 */

const XML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

export function escapeXml(input: string): string {
  return input.replace(/[&<>"']/g, (c) => XML_ESCAPES[c] ?? c);
}

/**
 * Resolve a path against a site URL into an absolute URL with no trailing
 * slash on the host. Idempotent for already-absolute URLs.
 */
export function absoluteUrl(siteUrl: string, path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const base = siteUrl.replace(/\/+$/, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${base}${suffix}`;
}

export function isoDate(value: string | Date | undefined): string | undefined {
  if (!value) return undefined;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}
