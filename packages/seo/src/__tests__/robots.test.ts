import { describe, expect, it } from "vitest";
import { AI_CRAWLERS, buildRobotsTxt } from "../robots.js";

describe("buildRobotsTxt", () => {
  it("allow-lists every documented AI crawler by default", () => {
    const txt = buildRobotsTxt({ siteUrl: "https://example.com" });
    for (const crawler of AI_CRAWLERS) {
      expect(txt).toContain(`User-agent: ${crawler.userAgent}`);
    }
    // Each allowed crawler gets `Allow: /` and inherits the global Disallow.
    for (const crawler of AI_CRAWLERS) {
      const block = extractBlockFor(txt, crawler.userAgent);
      expect(block).toContain("Allow: /");
    }
  });

  it("disallows admin and the MCP HTTP route by default", () => {
    const txt = buildRobotsTxt({ siteUrl: "https://example.com" });
    expect(txt).toContain("Disallow: /admin");
    expect(txt).toContain("Disallow: /api/mcp");
  });

  it("emits an absolute Sitemap reference", () => {
    const txt = buildRobotsTxt({ siteUrl: "https://example.com/" });
    expect(txt).toContain("Sitemap: https://example.com/sitemap.xml");
  });

  it("disallows every AI crawler when allowedCrawlers is 'none'", () => {
    const txt = buildRobotsTxt({
      siteUrl: "https://example.com",
      allowedCrawlers: "none",
    });
    for (const crawler of AI_CRAWLERS) {
      const block = extractBlockFor(txt, crawler.userAgent);
      expect(block).toContain("Disallow: /");
      expect(block).not.toContain("Allow: /");
    }
    // Catch-all `*` is still allowed.
    expect(txt).toMatch(/User-agent: \*\nAllow: \//);
  });

  it("respects an explicit allow list", () => {
    const txt = buildRobotsTxt({
      siteUrl: "https://example.com",
      allowedCrawlers: ["GPTBot", "ClaudeBot"],
    });
    expect(extractBlockFor(txt, "GPTBot")).toContain("Allow: /");
    expect(extractBlockFor(txt, "ClaudeBot")).toContain("Allow: /");
    expect(extractBlockFor(txt, "PerplexityBot")).toContain("Disallow: /");
  });
});

function extractBlockFor(txt: string, userAgent: string): string {
  const lines = txt.split("\n");
  const idx = lines.findIndex((line) => line === `User-agent: ${userAgent}`);
  if (idx === -1) return "";
  const block: string[] = [lines[idx] ?? ""];
  for (let i = idx + 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line === "") break;
    block.push(line);
  }
  return block.join("\n");
}
