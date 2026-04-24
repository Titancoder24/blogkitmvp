/**
 * `blogkit mcp-serve` — start the MCP server in stdio mode (PRD §9.2).
 *
 * The HTTP/SSE variant is mounted by the framework adapter at
 * `/api/mcp` of the host app; this command is the local-agent path
 * (Claude Code, Cursor stdio, Gemini CLI). The full server lives in
 * `@blogkit/mcp` and is wired up in week 14 of §12.
 */
import type { CliContext } from "./types.js";

export async function runMcpServe(_ctx: CliContext): Promise<number> {
  console.log(
    "blogkit mcp-serve — server pending. Will speak MCP over stdio (PRD §9).",
  );
  return 0;
}
