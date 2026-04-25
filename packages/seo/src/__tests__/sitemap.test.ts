import { describe, expect, it } from "vitest";
import { buildSitemap } from "../sitemap.js";

const NOW = new Date("2026-04-25T00:00:00Z");

describe("buildSitemap", () => {
  it("emits a snapshot with age-decayed priorities", () => {
    const xml = buildSitemap({
      siteUrl: "https://example.com",
      now: NOW,
      entries: [
        { url: "/", lastmod: "2026-04-20", changefreq: "daily" },
        // 14 days old → 1.0
        { url: "/blog/fresh", lastmod: "2026-04-11" },
        // 60 days old → 0.7
        { url: "/blog/stable", lastmod: "2026-02-24" },
        // 200 days old → 0.5
        { url: "/blog/decay", lastmod: "2025-10-07" },
        // cornerstone → 1.0 regardless of age
        { url: "/blog/cornerstone", lastmod: "2024-04-25", cornerstone: true },
      ],
    });
    expect(xml).toMatchInlineSnapshot(`
      "<?xml version=\\"1.0\\" encoding=\\"UTF-8\\"?>
      <urlset xmlns=\\"http://www.sitemaps.org/schemas/sitemap/0.9\\">
        <url>
          <loc>https://example.com/</loc>
          <lastmod>2026-04-20T00:00:00.000Z</lastmod>
          <changefreq>daily</changefreq>
          <priority>1.0</priority>
        </url>
        <url>
          <loc>https://example.com/blog/fresh</loc>
          <lastmod>2026-04-11T00:00:00.000Z</lastmod>
          <priority>1.0</priority>
        </url>
        <url>
          <loc>https://example.com/blog/stable</loc>
          <lastmod>2026-02-24T00:00:00.000Z</lastmod>
          <priority>0.7</priority>
        </url>
        <url>
          <loc>https://example.com/blog/decay</loc>
          <lastmod>2025-10-07T00:00:00.000Z</lastmod>
          <priority>0.5</priority>
        </url>
        <url>
          <loc>https://example.com/blog/cornerstone</loc>
          <lastmod>2024-04-25T00:00:00.000Z</lastmod>
          <priority>1.0</priority>
        </url>
      </urlset>
      "
    `);
  });

  it("escapes XML-unsafe characters in URLs", () => {
    const xml = buildSitemap({
      siteUrl: "https://example.com",
      entries: [{ url: "/q?x=a&b=c" }],
    });
    expect(xml).toContain("https://example.com/q?x=a&amp;b=c");
  });

  it("treats absolute URLs as-is", () => {
    const xml = buildSitemap({
      siteUrl: "https://example.com",
      entries: [{ url: "https://cdn.example.com/static" }],
    });
    expect(xml).toContain("https://cdn.example.com/static");
  });
});
