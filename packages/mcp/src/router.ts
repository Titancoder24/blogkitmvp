/**
 * Transport-agnostic dispatcher. The stdio and HTTP transports both
 * funnel through `dispatch` so the protocol surface stays consistent.
 */
import type { Federator } from "./federation.js";
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

export function listTools(federator?: Federator): readonly ToolSchema[] {
  if (!federator) return TOOL_SCHEMAS;
  return [...TOOL_SCHEMAS, ...federator.catalog()];
}

export function findToolSchema(
  name: string,
  federator?: Federator,
): ToolSchema | undefined {
  const local = TOOL_SCHEMAS.find((t) => t.name === name);
  if (local) return local;
  if (!federator) return undefined;
  return federator.catalog().find((t) => t.name === name);
}

export interface DispatchOptions {
  /** Token scope; if absent, write/admin tools are denied. */
  scope?: "read" | "write" | "admin";
  /** Federator to consult for namespaced tool names. */
  federator?: Federator;
}

export async function dispatch(
  ctx: HandlerContext,
  toolName: string,
  args: Record<string, unknown> = {},
  opts: DispatchOptions = {},
): Promise<DispatchResult> {
  // Federation route — namespaced tools (`notion__search_pages`, …) get
  // forwarded to their child MCP server.
  const federated = opts.federator?.route(toolName);
  if (federated) {
    const schema = federated.client.tools.find(
      (t) => t.name === federated.localName,
    );
    if (!schema) {
      return {
        ok: false,
        code: "unknown_tool",
        message: `Unknown federated tool '${federated.localName}' on '${federated.client.namespace}'.`,
      };
    }
    if (!scopeAllows(opts.scope, schema.scope)) {
      return {
        ok: false,
        code: "scope_denied",
        message: `Federated tool '${toolName}' requires '${schema.scope}' scope.`,
      };
    }
    try {
      const result = await federated.client.callTool(federated.localName, args);
      if (!result.ok) {
        return {
          ok: false,
          code: "internal",
          message: result.errorMessage ?? "Federated call failed.",
        };
      }
      // Audit-log federated calls so admins can see which agent hit which child.
      await ctx.adapter.audit.record({
        actorType: ctx.actorType,
        actorId: ctx.actorId,
        action: "mcp.federated.call",
        targetType: "integration",
        targetId: federated.client.namespace,
        payload: { tool: federated.localName },
      });
      return { ok: true, result: result.data };
    } catch (err) {
      return {
        ok: false,
        code: "internal",
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

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
    // Handlers can attach `code: "invalid_args"` to surface validation
    // failures as 4xx-class errors; everything else is a 5xx.
    const code =
      err && typeof err === "object" && "code" in err && err.code === "invalid_args"
        ? "invalid_args"
        : "internal";
    return {
      ok: false,
      code,
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
