/**
 * HTTP transport for the MCP server (PRD §9.2).
 *
 * The framework adapters mount this at `/api/mcp`. Requests are
 * authenticated via a bearer token issued from the admin UI; the token's
 * scope (read | write | admin) is passed through to the dispatcher.
 *
 * Protocol: JSON-RPC 2.0 over HTTP POST. The MCP TypeScript SDK speaks
 * this shape directly, so MCP-aware clients (Claude Code, Cursor,
 * Gemini CLI) can hit this endpoint without adapter glue.
 */
import type { BlogKitAdapter } from "@blogkit/supabase/adapter";
import type { Federator } from "./federation.js";
import { type HandlerContext } from "./handlers.js";
import { dispatch, listTools } from "./router.js";

export interface CreateMcpHttpHandlerOptions {
  adapter: BlogKitAdapter;
  /** Optional federator — when present, namespaced tools route to children. */
  federator?: Federator;
}

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export function createMcpHttpHandler(opts: CreateMcpHttpHandlerOptions) {
  const { adapter, federator } = opts;

  return async function handle(request: Request): Promise<Response> {
    if (request.method === "GET") {
      // Convenience handshake: return the tool catalog (including any
      // federated tools) as JSON so callers can preview what's available
      // without speaking JSON-RPC.
      return Response.json({ tools: listTools(federator) });
    }

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { Allow: "GET, POST" },
      });
    }

    const auth = request.headers.get("authorization") ?? "";
    const rawToken = auth.toLowerCase().startsWith("bearer ")
      ? auth.slice(7).trim()
      : null;
    if (!rawToken) {
      return new Response("Missing bearer token", { status: 401 });
    }

    const token = await adapter.mcpTokens.verify(rawToken);
    if (!token) {
      return new Response("Invalid or revoked token", { status: 401 });
    }

    let payload: JsonRpcRequest;
    try {
      payload = (await request.json()) as JsonRpcRequest;
    } catch {
      return Response.json(rpcError(null, -32700, "Parse error"), { status: 400 });
    }

    const ctx: HandlerContext = {
      adapter,
      actorType: "mcp_token",
      actorId: token.id,
    };

    if (payload.method === "tools/list") {
      return Response.json(rpcResult(payload.id, { tools: listTools(federator) }));
    }

    if (payload.method === "tools/call") {
      const params = (payload.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
      if (!params.name) {
        return Response.json(
          rpcError(payload.id, -32602, "tools/call requires `name` and `arguments`"),
          { status: 400 },
        );
      }
      const result = await dispatch(ctx, params.name, params.arguments ?? {}, {
        scope: token.scope,
        federator,
      });
      if (!result.ok) {
        const status =
          result.code === "scope_denied"
            ? 403
            : result.code === "unknown_tool"
            ? 404
            : 500;
        return Response.json(
          rpcError(payload.id, mapErrorCode(result.code), result.message),
          { status },
        );
      }
      return Response.json(
        rpcResult(payload.id, {
          content: [
            { type: "text", text: stringifyResult(result.result) },
          ],
          structuredContent: result.result,
          isError: false,
        }),
      );
    }

    return Response.json(
      rpcError(payload.id, -32601, `Method not found: ${payload.method}`),
      { status: 404 },
    );
  };
}

function rpcResult(id: JsonRpcRequest["id"], value: unknown) {
  return { jsonrpc: "2.0" as const, id, result: value };
}
function rpcError(id: JsonRpcRequest["id"], code: number, message: string) {
  return { jsonrpc: "2.0" as const, id, error: { code, message } };
}
function mapErrorCode(code: string): number {
  if (code === "unknown_tool") return -32601;
  if (code === "invalid_args") return -32602;
  if (code === "scope_denied") return -32099;
  return -32000;
}
function stringifyResult(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}
