/**
 * `@blogkit/mcp` — the MCP server package.
 *
 * - `serveMcpStdio(adapter)` for local agents (Claude Code, Cursor stdio,
 *   Gemini CLI). Started by `blogkit mcp-serve`.
 * - `createMcpHttpHandler(adapter)` for HTTP/SSE transport, mounted at
 *   `/api/mcp` by the framework adapters.
 * - `dispatch` and `listTools` for callers wiring custom transports.
 *
 * The tool surface (PRD §9.3) is described by `TOOL_SCHEMAS`; tool names
 * that v1.5 will add to enable agent-driven tool/template/theme creation
 * (PRD §19.2) are tracked in `FUTURE_TOOL_NAMES`.
 */
export { TOOL_NAMES } from "./tools.js";
export { TOOL_SCHEMAS } from "./schemas.js";
export type { JsonSchema, ToolSchema } from "./schemas.js";
export { dispatch, listTools, findToolSchema } from "./router.js";
export type { DispatchOptions, DispatchResult } from "./router.js";
export { handlers } from "./handlers.js";
export type { HandlerContext } from "./handlers.js";
export { serveMcpStdio } from "./stdio.js";
export type { ServeStdioOptions } from "./stdio.js";
export { createMcpHttpHandler } from "./http.js";
export type { CreateMcpHttpHandlerOptions } from "./http.js";

export { agentHandlers } from "./agent-tools.js";

/**
 * Agent-driven authoring tools that exist further down the v1.5 roadmap
 * but aren't shipped yet (themes, integrations, workflows). Listed here
 * so the catalog can be derived without spelunking through the codebase.
 */
export const FUTURE_TOOL_NAMES = [
  "create_theme",
  "create_integration",
  "create_workflow",
] as const;
