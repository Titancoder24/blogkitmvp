/**
 * `sitemap.xml` builder (PRD §6.1, §18.5).
 *
 * Per-URL priority decays with age:
 *   ≤ 30 days       → 1.0
 *   31–90 days      → 0.7
 *   > 90 days       → 0.5
 *   cornerstone     → 1.0 (pinned regardless of age)
 *
 * The decay schedule is intentionally aligned with the GEO research that
 * shows AI engines deprioritize content after the ~13-week mark — pinning
 * cornerstone posts keeps high-value evergreen content surfaced even as
 * the body of the corpus naturally drifts older.
 */
import { absoluteUrl, escapeXml, isoDate } from "./util.js";

export interface SitemapEntry {
  /** Path or absolute URL. Path is resolved against `siteUrl`. */
  url: string;
  /** Last modification timestamp (ISO 8601 or Date). */
  lastmod?: string | Date;
  changefreq?:
    | "always"
    | "hourly"
    | "daily"
    | "weekly"
    | "monthly"
    | "yearly"
    | "never";
  /** 0.0 – 1.0. If omitted, computed from `lastmod` and `cornerstone`. */
  priority?: number;
  /** Pin priority at 1.0 regardless of age (PRD §18.5). */
  cornerstone?: boolean;
}

export interface BuildSitemapOptions {
  siteUrl: string;
  entries: readonly SitemapEntry[];
  /** Reference time used for priority decay. Defaults to `new Date()`. */
  now?: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function buildSitemap(opts: BuildSitemapOptions): string {
  const now = opts.now ?? new Date();
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ];

  for (const entry of opts.entries) {
    const loc = escapeXml(absoluteUrl(opts.siteUrl, entry.url));
    const priority = entry.priority ?? computePriority(entry, now);
    const lastmod = isoDate(entry.lastmod);

    lines.push("  <url>");
    lines.push(`    <loc>${loc}</loc>`);
    if (lastmod) lines.push(`    <lastmod>${lastmod}</lastmod>`);
    if (entry.changefreq) lines.push(`    <changefreq>${entry.changefreq}</changefreq>`);
    lines.push(`    <priority>${priority.toFixed(1)}</priority>`);
    lines.push("  </url>");
  }

  lines.push("</urlset>");
  return `${lines.join("\n")}\n`;
}

function computePriority(entry: SitemapEntry, now: Date): number {
  if (entry.cornerstone) return 1.0;
  if (!entry.lastmod) return 0.7;
  const last =
    entry.lastmod instanceof Date ? entry.lastmod : new Date(entry.lastmod);
  const ageDays = (now.getTime() - last.getTime()) / DAY_MS;
  if (Number.isNaN(ageDays)) return 0.7;
  if (ageDays <= 30) return 1.0;
  if (ageDays <= 90) return 0.7;
  return 0.5;
}
