#!/usr/bin/env node
/**
 * `npx @blogkit/core <command>` — the install-and-operate entry point.
 *
 * Commands implemented in v1 (PRD §4):
 *   init        — detect framework, prompt for Supabase creds, run migrations,
 *                 scaffold routes, write blogkit.config.ts.
 *   migrate     — run the SQL migrations in @blogkit/supabase against the
 *                 configured Supabase project.
 *   doctor      — full diagnostic (PRD §4.3).
 *   mcp-serve   — start the MCP server in stdio mode for local agents.
 *   --version / --help
 *
 * In this scaffold each command prints what it will do and exits non-zero;
 * the real implementations land in week 4 (admin), week 14 (MCP) and week 15
 * (CLI polish) of §12.
 */
import { runDoctor } from "./doctor.js";
import { runInit } from "./init.js";
import { runMcpServe } from "./mcp-serve.js";
import { runMigrate } from "./migrate.js";

const VERSION = "0.0.0";

const HELP = `
BlogKit — the agent-native, SEO-maximal headless CMS.

Usage:
  npx @blogkit/core <command> [options]

Commands:
  init         Install BlogKit into the current project.
  migrate      Run pending SQL migrations against the configured Supabase project.
  doctor       Diagnose the install (env, schema, robots, llms.txt, JSON-LD).
  mcp-serve    Start the MCP server in stdio mode for local agent integration.

Options:
  --help       Show this message.
  --version    Print the package version.

Docs: https://github.com/titancoder24/blogkitmvp
`.trim();

type Command = "init" | "migrate" | "doctor" | "mcp-serve";

interface ParsedArgs {
  command?: Command;
  flags: Record<string, string | boolean>;
  positionals: string[];
}

function parseArgs(argv: string[]): ParsedArgs {
  const flags: Record<string, string | boolean> = {};
  const positionals: string[] = [];
  let command: Command | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq !== -1) {
        flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      } else {
        const next = argv[i + 1];
        if (next && !next.startsWith("--")) {
          flags[arg.slice(2)] = next;
          i++;
        } else {
          flags[arg.slice(2)] = true;
        }
      }
    } else if (!command && isCommand(arg)) {
      command = arg;
    } else {
      positionals.push(arg);
    }
  }

  return { command, flags, positionals };
}

function isCommand(value: string): value is Command {
  return (
    value === "init" ||
    value === "migrate" ||
    value === "doctor" ||
    value === "mcp-serve"
  );
}

async function main(): Promise<number> {
  const { command, flags } = parseArgs(process.argv.slice(2));

  if (flags.version || flags.v) {
    console.log(VERSION);
    return 0;
  }

  if (!command || flags.help || flags.h) {
    console.log(HELP);
    return command ? 0 : 1;
  }

  try {
    switch (command) {
      case "init":
        return await runInit({ flags });
      case "migrate":
        return await runMigrate({ flags });
      case "doctor":
        return await runDoctor({ flags });
      case "mcp-serve":
        return await runMcpServe({ flags });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`\nblogkit ${command} failed: ${message}`);
    return 1;
  }
}

main().then((code) => {
  process.exit(code);
});
