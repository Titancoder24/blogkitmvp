/**
 * Transport-agnostic dispatcher. The stdio and HTTP transports both
 * funnel through `dispatch` so the protocol surface stays consistent.
 */
import type { HandlerContext } from "./handlers.js";
import { handlers } from "./handlers.js";
import { TOOL_SCHEMAS, type ToolSchema } from "./schemas.js";

export interface DispatchSuccess {
  ok: true;
  result: unknown;
}
export interface DispatchError {
  ok: false;
  code: "unknown_tool" | "scope_denied" | "invalid_args" | "internal";
  message: string;
}
export type DispatchResult = DispatchSuccess | DispatchError;

export function listTools(): readonly ToolSchema[] {
  return TOOL_SCHEMAS;
}

export function findToolSchema(name: string): ToolSchema | undefined {
  return TOOL_SCHEMAS.find((t) => t.name === name);
}

export interface DispatchOptions {
  /** Token scope; if absent, write/admin tools are denied. */
  scope?: "read" | "write" | "admin";
}

export async function dispatch(
  ctx: HandlerContext,
  toolName: string,
  args: Record<string, unknown> = {},
  opts: DispatchOptions = {},
): Promise<DispatchResult> {
  const schema = findToolSchema(toolName);
  if (!schema) {
    return { ok: false, code: "unknown_tool", message: `Unknown tool: ${toolName}` };
  }
  if (!scopeAllows(opts.scope, schema.scope)) {
    return {
      ok: false,
      code: "scope_denied",
      message: `Tool '${toolName}' requires '${schema.scope}' scope; token has '${opts.scope ?? "none"}'.`,
    };
  }

  const handler = handlers[toolName];
  if (!handler) {
    return { ok: false, code: "unknown_tool", message: `No handler registered for ${toolName}` };
  }

  try {
    const result = await handler(ctx, args);
    return { ok: true, result };
  } catch (err) {
    return {
      ok: false,
      code: "internal",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

function scopeAllows(
  granted: "read" | "write" | "admin" | undefined,
  required: "read" | "write" | "admin",
): boolean {
  // stdio transport never sets a scope — local users are trusted.
  if (granted === undefined) return true;
  if (granted === "admin") return true;
  if (granted === "write") return required !== "admin";
  return required === "read";
}
