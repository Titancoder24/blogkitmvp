/**
 * RSS 2.0 and Atom 1.0 feed builders (PRD §6.1, §8.3).
 *
 * Feeds are cached at the edge with a 5-minute TTL and invalidated on
 * publish (PRD §8.3). The functions here are pure — the caching layer
 * lives in the framework adapters.
 */
import type { Author, Post, SiteConfig } from "@blogkit/core/types";
import { absoluteUrl, escapeXml, isoDate } from "./util.js";

export interface FeedEntry {
  post: Pick<
    Post,
    | "slug"
    | "title"
    | "excerpt"
    | "tldr"
    | "bodyHtml"
    | "publishedAt"
    | "lastRefreshedAt"
    | "createdAt"
    | "updatedAt"
  >;
  author?: Pick<Author, "name" | "website">;
}

export interface BuildFeedOptions {
  site: SiteConfig;
  entries: readonly FeedEntry[];
  /** Defaults to `now()`. */
  builtAt?: Date;
}

// ---------- RSS 2.0 ----------
export function buildRssFeed(opts: BuildFeedOptions): string {
  const builtAt = (opts.builtAt ?? new Date()).toUTCString();
  const link = opts.site.url.replace(/\/+$/, "");
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">',
    "  <channel>",
    `    <title>${escapeXml(opts.site.name)}</title>`,
    `    <link>${escapeXml(link)}</link>`,
    `    <description>${escapeXml(opts.site.tagline ?? opts.site.name)}</description>`,
    `    <lastBuildDate>${builtAt}</lastBuildDate>`,
    `    <atom:link href="${escapeXml(`${link}/rss.xml`)}" rel="self" type="application/rss+xml" />`,
  ];

  for (const entry of opts.entries) {
    const url = absoluteUrl(opts.site.url, `/blog/${entry.post.slug}`);
    const pubDateValue = entry.post.publishedAt ?? entry.post.createdAt;
    const pubDate = pubDateValue ? new Date(pubDateValue).toUTCString() : builtAt;
    const description = entry.post.tldr ?? entry.post.excerpt ?? "";
    lines.push("    <item>");
    lines.push(`      <title>${escapeXml(entry.post.title)}</title>`);
    lines.push(`      <link>${escapeXml(url)}</link>`);
    lines.push(`      <guid isPermaLink="true">${escapeXml(url)}</guid>`);
    lines.push(`      <pubDate>${pubDate}</pubDate>`);
    if (description) {
      lines.push(`      <description>${escapeXml(description)}</description>`);
    }
    if (entry.post.bodyHtml) {
      lines.push(
        `      <content:encoded><![CDATA[${entry.post.bodyHtml}]]></content:encoded>`,
      );
    }
    if (entry.author?.name) {
      lines.push(`      <dc:creator>${escapeXml(entry.author.name)}</dc:creator>`);
    }
    lines.push("    </item>");
  }

  lines.push("  </channel>", "</rss>");
  return `${lines.join("\n")}\n`;
}

// ---------- Atom 1.0 ----------
export function buildAtomFeed(opts: BuildFeedOptions): string {
  const builtAt = isoDate((opts.builtAt ?? new Date()).toISOString());
  const link = opts.site.url.replace(/\/+$/, "");
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    `  <title>${escapeXml(opts.site.name)}</title>`,
    `  <subtitle>${escapeXml(opts.site.tagline ?? "")}</subtitle>`,
    `  <link href="${escapeXml(link)}" />`,
    `  <link href="${escapeXml(`${link}/atom.xml`)}" rel="self" />`,
    `  <id>${escapeXml(`${link}/`)}</id>`,
    `  <updated>${builtAt}</updated>`,
  ];

  for (const entry of opts.entries) {
    const url = absoluteUrl(opts.site.url, `/blog/${entry.post.slug}`);
    const updated = isoDate(
      entry.post.lastRefreshedAt ?? entry.post.updatedAt ?? entry.post.publishedAt,
    );
    const published = isoDate(entry.post.publishedAt ?? entry.post.createdAt);
    const summary = entry.post.tldr ?? entry.post.excerpt ?? "";
    lines.push("  <entry>");
    lines.push(`    <title>${escapeXml(entry.post.title)}</title>`);
    lines.push(`    <link href="${escapeXml(url)}" />`);
    lines.push(`    <id>${escapeXml(url)}</id>`);
    if (published) lines.push(`    <published>${published}</published>`);
    if (updated) lines.push(`    <updated>${updated}</updated>`);
    if (entry.author?.name) {
      lines.push("    <author>");
      lines.push(`      <name>${escapeXml(entry.author.name)}</name>`);
      if (entry.author.website) {
        lines.push(`      <uri>${escapeXml(entry.author.website)}</uri>`);
      }
      lines.push("    </author>");
    }
    if (summary) {
      lines.push(`    <summary>${escapeXml(summary)}</summary>`);
    }
    if (entry.post.bodyHtml) {
      lines.push(
        `    <content type="html"><![CDATA[${entry.post.bodyHtml}]]></content>`,
      );
    }
    lines.push("  </entry>");
  }

  lines.push("</feed>");
  return `${lines.join("\n")}\n`;
}
