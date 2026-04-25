/**
 * `blogkit mcp-serve` — start the MCP server in stdio mode (PRD §9.2).
 *
 * Launched by local agents like Claude Code as a subprocess. Reads the
 * Supabase service-role credentials from env, builds an adapter, and
 * hands off to `@blogkit/mcp/stdio`.
 *
 * The HTTP/SSE variant lives at `/api/mcp` of the host app — that's
 * mounted by the framework adapter, not by this command.
 */
import type { CliContext } from "./types.js";

export async function runMcpServe(_ctx: CliContext): Promise<number> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(
      "Missing SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY.\n" +
        "Set them in .env.local or export them in the parent shell.",
    );
    return 1;
  }

  // These three are runtime peers; the user installs them when they run
  // `npx @blogkit/core init`. Typed loosely so type-checking the CLI
  // doesn't depend on the runtime peers being present at build time.
  let createClient: any;
  let createSupabaseAdapter: any;
  let serveMcpStdio: any;
  try {
    ({ createClient } = await import("@supabase/supabase-js" as string));
    ({ createSupabaseAdapter } = await import("@blogkit/supabase" as string));
    ({ serveMcpStdio } = await import("@blogkit/mcp/stdio" as string));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `Failed to load runtime dependencies: ${message}\n` +
        "Ensure @supabase/supabase-js, @blogkit/supabase, @blogkit/mcp, and " +
        "@modelcontextprotocol/sdk are all installed.",
    );
    return 1;
  }

  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const adapter = createSupabaseAdapter({ client });
  await serveMcpStdio({ adapter, serverName: "@blogkit/mcp" });
  return 0;
}
