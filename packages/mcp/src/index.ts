/**
 * `@blogkit/mcp` — MCP server.
 *
 * The full server (PRD §9) lands in week 14 of §12. This file exists so
 * dependents can already import the package; the implementation will:
 *
 *   - speak MCP over stdio (for Claude Code, Cursor stdio, Gemini CLI),
 *   - speak MCP over HTTP/SSE (mounted at `/api/mcp` by framework adapters),
 *   - expose the tool surface in PRD §9.3 (content, taxonomy, media,
 *     SEO, template introspection, theme tools),
 *   - authenticate via tokens from `BlogKitAdapter.mcpTokens`,
 *   - emit one row to `audit_log` per write/publish action.
 */
import type { TOOL_NAMES } from "./tools.js";
export { TOOL_NAMES };
export type ToolName = (typeof TOOL_NAMES)[number];
