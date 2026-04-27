/**
 * OpenAPI 3.1 spec auto-generator (PRD §6.7 — closes the ai-plugin loop).
 *
 * Served at `/openapi.json` and referenced from the
 * `/.well-known/ai-plugin.json` manifest's `api.url` field. Agents using
 * the OpenAPI plugin protocol (older OpenAI plugins, n8n, Zapier MCP
 * gateway) can discover the BlogKit surface from this single document.
 *
 * The spec is derived from:
 *   - the resolved BlogKit config (server URL, security schemes)
 *   - the MCP tool surface (each tool becomes one operation)
 *
 * Pure-function so it's testable and free of I/O.
 */
import type { ResolvedBlogKitConfig } from "@blogkit/core/types";

export interface OpenApiTool {
  name: string;
  description: string;
  scope: "read" | "write" | "admin";
  inputSchema: Record<string, unknown>;
}

export interface BuildOpenApiSpecInput {
  config: ResolvedBlogKitConfig;
  tools: readonly OpenApiTool[];
  /** Override the spec's `info.version`. Defaults to "0.0.0". */
  version?: string;
  /** Path the MCP HTTP transport is mounted at. Defaults from config. */
  mcpPath?: string;
}

export function buildOpenApiSpec(
  input: BuildOpenApiSpecInput,
): Record<string, unknown> {
  const base = input.config.site.url.replace(/\/+$/, "");
  const mcpPath = input.mcpPath ?? input.config.mcp.mountPath ?? "/api/mcp";

  const paths: Record<string, unknown> = {};
  for (const tool of input.tools) {
    paths[`/api/tools/${tool.name}`] = {
      post: {
        operationId: tool.name,
        summary: tool.description,
        "x-mcp-scope": tool.scope,
        tags: [tagFor(tool.name)],
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: tool.inputSchema,
            },
          },
        },
        responses: {
          "200": {
            description: "Success",
            content: {
              "application/json": {
                schema: { type: "object" },
              },
            },
          },
          "400": { description: "Invalid arguments." },
          "401": { description: "Missing or invalid bearer token." },
          "403": { description: "Token scope insufficient for this tool." },
          "404": { description: "Tool not found." },
        },
      },
    };
  }

  // Single composite endpoint for MCP-aware clients that prefer a JSON-RPC
  // entrypoint over per-tool routes.
  paths[mcpPath] = {
    post: {
      operationId: "mcpJsonRpc",
      summary: "JSON-RPC 2.0 entrypoint for MCP-aware clients.",
      tags: ["mcp"],
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["jsonrpc", "method"],
              properties: {
                jsonrpc: { type: "string", enum: ["2.0"] },
                id: {},
                method: {
                  type: "string",
                  enum: ["tools/list", "tools/call"],
                },
                params: { type: "object" },
              },
            },
          },
        },
      },
      responses: {
        "200": { description: "JSON-RPC response." },
        "401": { description: "Missing or invalid bearer token." },
      },
    },
    get: {
      operationId: "mcpToolCatalog",
      summary: "Convenience catalog of available tools (no auth).",
      tags: ["mcp"],
      responses: {
        "200": { description: "Tool catalog." },
      },
    },
  };

  return {
    openapi: "3.1.0",
    info: {
      title: `${input.config.site.name} — BlogKit API`,
      version: input.version ?? "0.0.0",
      description:
        `Programmatic access to ${input.config.site.name} via the BlogKit ` +
        `MCP surface. Speak JSON-RPC 2.0 to ${mcpPath}, or call individual ` +
        `tools through the per-tool routes documented here.`,
      "x-blogkit": {
        tools: input.tools.length,
        mcp: { mountPath: mcpPath, transport: "http+sse" },
      },
    },
    servers: [{ url: base }],
    security: [{ bearerAuth: [] }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "BlogKitToken",
          description:
            "Bearer token issued from the BlogKit admin (`/admin/tokens`). The token's scope (read/write/admin) gates which tools it can call.",
        },
      },
      schemas: {},
    },
    paths,
    tags: [
      { name: "content", description: "Posts, pages, revisions." },
      { name: "taxonomy", description: "Tags, categories, authors." },
      { name: "media", description: "Images and file uploads." },
      { name: "seo", description: "Reports and artifact regeneration." },
      { name: "templates", description: "Content-type definitions." },
      { name: "mcp", description: "JSON-RPC entrypoint for MCP clients." },
    ],
  };
}

function tagFor(toolName: string): string {
  if (toolName.includes("template")) return "templates";
  if (toolName.includes("media")) return "media";
  if (toolName.includes("tag") || toolName.includes("categor") || toolName.includes("author")) {
    return "taxonomy";
  }
  if (toolName.includes("seo") || toolName.includes("schema") || toolName.includes("regenerate") || toolName.includes("audit")) {
    return "seo";
  }
  return "content";
}
