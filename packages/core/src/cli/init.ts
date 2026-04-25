/**
 * `blogkit init` — install BlogKit into the current project (PRD §4.1).
 *
 * Steps:
 *   1. Detect the host framework (Next.js / Remix / Astro) by reading
 *      package.json + config files.
 *   2. Prompt for SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
 *      DATABASE_URL (or read from an existing .env.local).
 *   3. Append missing keys to .env.local.
 *   4. Write blogkit.config.ts at the project root.
 *   5. Print follow-up instructions for `blogkit migrate`.
 *
 * The interactive prompts are kept minimal — fewer than five questions per
 * the success criterion in PRD §1.4.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { CliContext } from "./types.js";

type Framework = "next" | "remix" | "astro" | "unknown";

export async function runInit(ctx: CliContext): Promise<number> {
  const cwd = process.cwd();
  console.log("BlogKit installer");
  console.log("─".repeat(40));

  const framework = await detectFramework(cwd);
  console.log(
    framework === "unknown"
      ? "Couldn't detect a framework. Continuing anyway — you can wire routes manually."
      : `Detected: ${frameworkLabel(framework)}`,
  );

  const nonInteractive = Boolean(ctx.flags.yes || ctx.flags.y);
  const env = await readExistingEnv(join(cwd, ".env.local"));

  const supabaseUrl =
    (ctx.flags["supabase-url"] as string | undefined) ??
    env.SUPABASE_URL ??
    (nonInteractive ? "" : await prompt("Supabase project URL: "));
  const supabaseAnonKey =
    (ctx.flags["supabase-anon-key"] as string | undefined) ??
    env.SUPABASE_ANON_KEY ??
    (nonInteractive ? "" : await prompt("Supabase anon key: "));
  const supabaseServiceKey =
    (ctx.flags["supabase-service-key"] as string | undefined) ??
    env.SUPABASE_SERVICE_ROLE_KEY ??
    (nonInteractive ? "" : await prompt("Supabase service role key: "));
  const databaseUrl =
    (ctx.flags["database-url"] as string | undefined) ??
    env.DATABASE_URL ??
    (nonInteractive
      ? ""
      : await prompt("Postgres connection string (for migrations): "));
  const siteUrl =
    (ctx.flags["site-url"] as string | undefined) ??
    (nonInteractive ? "http://localhost:3000" : await prompt("Site URL: "));
  const siteName =
    (ctx.flags["site-name"] as string | undefined) ??
    (nonInteractive ? "BlogKit Site" : await prompt("Site name: "));

  await writeEnv(join(cwd, ".env.local"), {
    SUPABASE_URL: supabaseUrl,
    SUPABASE_ANON_KEY: supabaseAnonKey,
    SUPABASE_SERVICE_ROLE_KEY: supabaseServiceKey,
    DATABASE_URL: databaseUrl,
  });

  await writeBlogKitConfig(join(cwd, "blogkit.config.ts"), {
    name: siteName,
    url: siteUrl,
  });

  console.log("\nInstall complete.\n");
  console.log("Next steps:");
  console.log("  1. blogkit migrate           # apply database migrations");
  console.log("  2. (optional) blogkit doctor # diagnose the install");
  console.log(`  3. Start your ${frameworkLabel(framework)} dev server.`);
  console.log("\nMCP integration:");
  console.log("  Add this to your local agent's MCP config to operate the blog:");
  console.log(`    { "command": "npx", "args": ["@blogkit/core", "mcp-serve"] }`);

  return 0;
}

async function detectFramework(cwd: string): Promise<Framework> {
  const pkgPath = join(cwd, "package.json");
  if (!existsSync(pkgPath)) return "unknown";
  try {
    const raw = await readFile(pkgPath, "utf8");
    const pkg = JSON.parse(raw) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (deps["next"]) return "next";
    if (deps["@remix-run/react"] || deps["@remix-run/node"]) return "remix";
    if (deps["astro"]) return "astro";
  } catch {
    // fall through
  }
  return "unknown";
}

function frameworkLabel(framework: Framework): string {
  if (framework === "next") return "Next.js";
  if (framework === "remix") return "Remix";
  if (framework === "astro") return "Astro";
  return "host framework";
}

async function readExistingEnv(path: string): Promise<Record<string, string>> {
  if (!existsSync(path)) return {};
  const text = await readFile(path, "utf8");
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (m) out[m[1]!] = stripQuotes(m[2] ?? "");
  }
  return out;
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

async function writeEnv(
  path: string,
  values: Record<string, string>,
): Promise<void> {
  const existing = existsSync(path) ? await readFile(path, "utf8") : "";
  const lines = existing ? existing.split(/\r?\n/) : [];
  const present = new Set<string>();
  const out: string[] = [];

  for (const line of lines) {
    const m = /^([A-Z_][A-Z0-9_]*)=/.exec(line.trim());
    if (m && m[1] && m[1] in values && values[m[1]]) {
      out.push(`${m[1]}=${quoteIfNeeded(values[m[1]] ?? "")}`);
      present.add(m[1]);
    } else {
      out.push(line);
    }
  }

  for (const [key, value] of Object.entries(values)) {
    if (!value || present.has(key)) continue;
    out.push(`${key}=${quoteIfNeeded(value)}`);
  }

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${out.filter((l, i) => l !== "" || i < out.length - 1).join("\n").replace(/\n+$/, "")}\n`);
}

function quoteIfNeeded(value: string): string {
  return /\s/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}

async function writeBlogKitConfig(
  path: string,
  site: { name: string; url: string },
): Promise<void> {
  if (existsSync(path)) {
    console.log(`Skipping ${resolve(path)} (already exists).`);
    return;
  }
  const content = `import { defineConfig } from "@blogkit/core/config";

export default defineConfig({
  site: {
    name: ${JSON.stringify(site.name)},
    url: ${JSON.stringify(site.url)},
  },
  organization: {
    name: ${JSON.stringify(site.name)},
    sameAs: [
      // Add your Wikidata, LinkedIn, GitHub, Crunchbase URLs here.
      // Required for the AIO discipline (entity disambiguation).
    ],
  },
  ai: {
    allowedCrawlers: "all",
    llmsTxtMaxLinks: 50,
    freshnessWarningDays: 14,
  },
  mcp: {
    enabled: true,
    mountPath: "/api/mcp",
  },
  theme: "pragma",
});
`;
  await writeFile(path, content);
}

async function prompt(label: string): Promise<string> {
  const rl = readline.createInterface({ input, output });
  try {
    const answer = await rl.question(label);
    return answer.trim();
  } finally {
    rl.close();
  }
}
