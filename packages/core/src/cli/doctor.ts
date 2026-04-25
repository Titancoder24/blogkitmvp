/**
 * `blogkit doctor` — diagnose the install (PRD §4.3).
 *
 * Each check is self-contained: it prints a one-line `✓` or `✗` plus, on
 * failure, a one-line fix. Exit code reflects whether any required check
 * failed (1) or only optional checks failed (0).
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { AI_CRAWLERS } from "@blogkit/seo";
import type { CliContext } from "./types.js";

interface CheckResult {
  name: string;
  ok: boolean;
  /** When true, a failure causes a non-zero exit code. */
  required: boolean;
  detail?: string;
  fix?: string;
}

export async function runDoctor(ctx: CliContext): Promise<number> {
  const cwd = process.cwd();
  const siteUrl =
    (ctx.flags["site-url"] as string | undefined) ?? process.env.BLOGKIT_SITE_URL;

  console.log("BlogKit doctor");
  console.log("─".repeat(40));

  const results: CheckResult[] = [];

  results.push(checkEnv("SUPABASE_URL", true));
  results.push(checkEnv("SUPABASE_ANON_KEY", true));
  results.push(checkEnv("SUPABASE_SERVICE_ROLE_KEY", true));
  results.push(checkEnv("DATABASE_URL", false));

  results.push(checkFile("blogkit.config.ts", join(cwd, "blogkit.config.ts"), true));
  results.push(checkFile(".env.local", join(cwd, ".env.local"), true));

  if (siteUrl) {
    results.push(await checkRobotsAi(siteUrl));
    results.push(await checkLlmsTxt(siteUrl));
    results.push(await checkAiPluginManifest(siteUrl));
    results.push(await checkSitemap(siteUrl));
  } else {
    results.push({
      name: "live URL probes",
      ok: false,
      required: false,
      detail: "Skipped (no --site-url or BLOGKIT_SITE_URL).",
      fix: "Pass --site-url=https://yourblog.com to probe robots.txt, llms.txt, sitemap, and ai-plugin.json.",
    });
  }

  let failed = 0;
  for (const result of results) {
    const symbol = result.ok ? "✓" : "✗";
    const required = result.required ? " [required]" : "";
    const detail = result.detail ? ` — ${result.detail}` : "";
    console.log(`${symbol} ${result.name}${required}${detail}`);
    if (!result.ok) {
      if (result.fix) console.log(`    fix: ${result.fix}`);
      if (result.required) failed += 1;
    }
  }

  console.log("─".repeat(40));
  console.log(failed === 0 ? "All required checks passed." : `${failed} required check(s) failed.`);
  return failed === 0 ? 0 : 1;
}

function checkEnv(name: string, required: boolean): CheckResult {
  const value = process.env[name];
  return {
    name: `env ${name}`,
    ok: Boolean(value),
    required,
    fix: `Add ${name} to .env.local.`,
  };
}

function checkFile(name: string, path: string, required: boolean): CheckResult {
  return {
    name,
    ok: existsSync(path),
    required,
    fix: `Run \`blogkit init\` to scaffold ${name}.`,
  };
}

async function fetchOk(url: string): Promise<{ ok: boolean; text: string; status: number }> {
  try {
    const res = await fetch(url, { redirect: "follow" });
    const text = await res.text();
    return { ok: res.ok, text, status: res.status };
  } catch (err) {
    return { ok: false, text: err instanceof Error ? err.message : String(err), status: 0 };
  }
}

async function checkRobotsAi(siteUrl: string): Promise<CheckResult> {
  const { ok, text } = await fetchOk(absolute(siteUrl, "/robots.txt"));
  if (!ok) {
    return {
      name: "/robots.txt reachable",
      ok: false,
      required: true,
      fix: "Mount the robots.txt route from @blogkit/next (or your framework adapter).",
    };
  }
  const blocked: string[] = [];
  for (const crawler of AI_CRAWLERS) {
    const re = new RegExp(
      `User-agent:\\s*${crawler.userAgent}\\s*\\nAllow:\\s*/`,
      "i",
    );
    if (!re.test(text)) blocked.push(crawler.userAgent);
  }
  return {
    name: "robots.txt allows all AI crawlers",
    ok: blocked.length === 0,
    required: true,
    detail:
      blocked.length === 0
        ? `${AI_CRAWLERS.length} crawlers allowed.`
        : `Missing/blocked: ${blocked.join(", ")}`,
    fix: "Set ai.allowedCrawlers to 'all' in blogkit.config.ts and republish.",
  };
}

async function checkLlmsTxt(siteUrl: string): Promise<CheckResult> {
  const { ok, text } = await fetchOk(absolute(siteUrl, "/llms.txt"));
  if (!ok) {
    return {
      name: "/llms.txt reachable",
      ok: false,
      required: true,
      fix: "Mount the llms.txt route handler from @blogkit/next.",
    };
  }
  const valid = text.trimStart().startsWith("# ");
  return {
    name: "/llms.txt parses",
    ok: valid,
    required: true,
    detail: valid ? `${text.length} bytes` : undefined,
    fix: "llms.txt should start with `# <Site Name>`. Check the route handler output.",
  };
}

async function checkAiPluginManifest(siteUrl: string): Promise<CheckResult> {
  const { ok, text, status } = await fetchOk(
    absolute(siteUrl, "/.well-known/ai-plugin.json"),
  );
  if (!ok) {
    return {
      name: "/.well-known/ai-plugin.json",
      ok: false,
      required: false,
      detail: status ? `HTTP ${status}` : undefined,
      fix: "Mount the ai-plugin.json handler from @blogkit/next so MCP/OpenAPI clients can discover the site.",
    };
  }
  try {
    const json = JSON.parse(text) as { schema_version?: string };
    return {
      name: "ai-plugin.json valid",
      ok: json.schema_version === "v1",
      required: false,
      fix: "Manifest must declare schema_version 'v1'.",
    };
  } catch {
    return {
      name: "ai-plugin.json valid",
      ok: false,
      required: false,
      fix: "Manifest is not valid JSON.",
    };
  }
}

async function checkSitemap(siteUrl: string): Promise<CheckResult> {
  const { ok, text, status } = await fetchOk(absolute(siteUrl, "/sitemap.xml"));
  if (!ok) {
    return {
      name: "/sitemap.xml reachable",
      ok: false,
      required: true,
      detail: status ? `HTTP ${status}` : undefined,
      fix: "Mount the sitemap handler from @blogkit/next.",
    };
  }
  const ok2 = /<urlset\b/.test(text);
  return {
    name: "/sitemap.xml well-formed",
    ok: ok2,
    required: true,
    fix: "Sitemap output should contain a <urlset> root element.",
  };
}

function absolute(siteUrl: string, path: string): string {
  const base = siteUrl.replace(/\/+$/, "");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

// Suppress unused-variable warning for readFile (kept for future use when
// doctor inspects local artifacts in addition to live URLs).
void readFile;
