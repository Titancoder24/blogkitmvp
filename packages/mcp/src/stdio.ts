/**
 * Stdio transport for the MCP server (PRD §9.2).
 *
 * Used by local agents — Claude Code, Cursor (stdio mode), Gemini CLI.
 * The host launches `blogkit mcp-serve` as a subprocess and speaks
 * JSON-RPC 2.0 framed by Content-Length headers (the standard MCP
 * stdio transport).
 *
 * We use `@modelcontextprotocol/sdk`'s `Server` class with
 * `StdioServerTransport`. The SDK is an optional peer dep; when it's
 * absent we fail clearly with install instructions.
 */
import type { BlogKitAdapter } from "@blogkit/supabase/adapter";
import { type HandlerContext } from "./handlers.js";
import { dispatch, listTools } from "./router.js";

export interface ServeStdioOptions {
  adapter: BlogKitAdapter;
  /** Server name reported during MCP `initialize`. */
  serverName?: string;
  serverVersion?: string;
}

export async function serveMcpStdio(opts: ServeStdioOptions): Promise<void> {
  // The SDK is an optional peer dep; the import shape is unknown at
  // build time. We type it as `any` here and lean on runtime errors for
  // shape mismatches — the SDK has been stable for over a year.
  let sdk: any;
  let stdio: any;
  try {
    [sdk, stdio] = await Promise.all([
      import("@modelcontextprotocol/sdk/server/index.js" as string),
      import("@modelcontextprotocol/sdk/server/stdio.js" as string),
    ]);
  } catch {
    throw new Error(
      "MCP stdio transport requires @modelcontextprotocol/sdk.\n" +
        "Install with: npm install @modelcontextprotocol/sdk",
    );
  }

  const server = new sdk.Server(
    {
      name: opts.serverName ?? "@blogkit/mcp",
      version: opts.serverVersion ?? "0.0.0",
    },
    {
      capabilities: { tools: {} },
    },
  );

  const ctx: HandlerContext = {
    adapter: opts.adapter,
    actorType: "system",
  };

  // tools/list — return the schema catalog.
  server.setRequestHandler(
    {
      method: "tools/list",
    } as any,
    async () => ({ tools: listTools() }),
  );

  // tools/call — dispatch to the handler registry.
  server.setRequestHandler(
    {
      method: "tools/call",
    } as any,
    async (request: any) => {
      const params = (request?.params ?? {}) as {
        name?: string;
        arguments?: Record<string, unknown>;
      };
      if (!params.name) {
        return {
          content: [{ type: "text", text: "Missing tool name" }],
          isError: true,
        };
      }
      const result = await dispatch(ctx, params.name, params.arguments ?? {}, {
        // stdio transport runs as the local user — no scope gate.
      });
      if (!result.ok) {
        return {
          content: [{ type: "text", text: result.message }],
          isError: true,
        };
      }
      return {
        content: [{ type: "text", text: stringifyResult(result.result) }],
        structuredContent: result.result,
        isError: false,
      };
    },
  );

  const transport = new stdio.StdioServerTransport();
  await server.connect(transport);
}

function stringifyResult(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}
