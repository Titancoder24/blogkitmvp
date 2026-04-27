/**
 * MCP federation runtime (PRD §19.4 — multi-provider agent control plane).
 *
 * Lets BlogKit's MCP server *mount* third-party MCP servers (Notion,
 * Drive, Spotify, Stripe, …) under a namespace. From an agent's
 * perspective, the federated tools look like first-class BlogKit tools
 * with namespaced names: `notion__search_pages`, `drive__list_files`,
 * `stripe__create_invoice`. One bearer token, one endpoint, full graph.
 *
 * Architecture:
 *   - `FederatedClient` wraps a child MCP transport (stdio subprocess
 *     or HTTP/SSE) and exposes `listTools` / `callTool`.
 *   - `Federator` holds the registry of mounted clients and merges their
 *     tool catalogs into BlogKit's own.
 *   - The HTTP and stdio transports check whether a tool name matches
 *     `<namespace>__<tool>` and, if so, route the call to the
 *     corresponding `FederatedClient` instead of the local registry.
 *
 * Safety:
 *   - Each integration's credentials live in `blogkit_mcp_integrations`
 *     and are passed to the child transport at mount time, not exposed
 *     to the calling agent.
 *   - Callers' scope is enforced before federating: a `read` token can
 *     only call read tools (the BlogKit dispatcher annotates the
 *     federated tool's scope at mount time based on the integration's
 *     declared capabilities).
 *   - Audit log records federated calls with `actor_type='mcp_token'`
 *     and `payload.namespace=<integration>`.
 */
import type { ToolSchema } from "./schemas.js";

export interface FederatedToolCallResult {
  ok: boolean;
  /** Free-form result payload from the child server. */
  data?: unknown;
  errorMessage?: string;
}

export interface FederatedClient {
  /** Namespace prefix used to disambiguate tools. e.g. "notion". */
  namespace: string;
  /** Human-readable name for dashboards and audit logs. */
  displayName: string;
  /** Cached tool catalog (refreshed via `refreshTools`). */
  tools: readonly ToolSchema[];
  /** Refresh the catalog by calling `tools/list` against the child. */
  refreshTools(): Promise<readonly ToolSchema[]>;
  /** Forward a tool call. The dispatcher already validated the scope. */
  callTool(toolName: string, args: Record<string, unknown>): Promise<FederatedToolCallResult>;
  /** Tear down the underlying transport. */
  close(): Promise<void>;
}

export interface Federator {
  list(): readonly FederatedClient[];
  get(namespace: string): FederatedClient | undefined;
  /** Merge each client's tools into one catalog with namespaced names. */
  catalog(): readonly ToolSchema[];
  /**
   * Resolve `notion__search_pages` to its `FederatedClient`.
   * Returns `null` if the name isn't a federated tool.
   */
  route(toolName: string): { client: FederatedClient; localName: string } | null;
  mount(client: FederatedClient): void;
  unmount(namespace: string): Promise<void>;
}

const NAMESPACE_DELIMITER = "__";

export function createFederator(): Federator {
  const clients = new Map<string, FederatedClient>();

  return {
    list() {
      return [...clients.values()];
    },
    get(namespace) {
      return clients.get(namespace);
    },
    catalog() {
      const out: ToolSchema[] = [];
      for (const client of clients.values()) {
        for (const tool of client.tools) {
          out.push({
            ...tool,
            name: `${client.namespace}${NAMESPACE_DELIMITER}${tool.name}`,
            description:
              `[${client.displayName}] ${tool.description}`,
          });
        }
      }
      return out;
    },
    route(toolName) {
      const idx = toolName.indexOf(NAMESPACE_DELIMITER);
      if (idx === -1) return null;
      const namespace = toolName.slice(0, idx);
      const local = toolName.slice(idx + NAMESPACE_DELIMITER.length);
      const client = clients.get(namespace);
      if (!client) return null;
      return { client, localName: local };
    },
    mount(client) {
      if (clients.has(client.namespace)) {
        throw new Error(
          `Federation namespace '${client.namespace}' is already mounted.`,
        );
      }
      clients.set(client.namespace, client);
    },
    async unmount(namespace) {
      const client = clients.get(namespace);
      if (!client) return;
      await client.close();
      clients.delete(namespace);
    },
  };
}

// ---------- stdio child transport ----------
/**
 * Spawn a child MCP server over stdio and wrap it as a `FederatedClient`.
 * Real implementation uses `node:child_process.spawn` and the
 * `@modelcontextprotocol/sdk/client/stdio.js` client. Kept behind a
 * dynamic import so the SDK stays optional.
 */
export async function mountStdioClient(input: {
  namespace: string;
  displayName: string;
  command: string;
  args?: readonly string[];
  env?: Record<string, string>;
}): Promise<FederatedClient> {
  let sdk: any;
  let childTransport: any;
  try {
    [sdk, childTransport] = await Promise.all([
      import("@modelcontextprotocol/sdk/client/index.js" as string),
      import("@modelcontextprotocol/sdk/client/stdio.js" as string),
    ]);
  } catch {
    throw new Error(
      "MCP federation requires @modelcontextprotocol/sdk.\n" +
        "Install with: npm install @modelcontextprotocol/sdk",
    );
  }

  const transport = new childTransport.StdioClientTransport({
    command: input.command,
    args: [...(input.args ?? [])],
    env: input.env,
  });
  const client = new sdk.Client(
    { name: `@blogkit/federated/${input.namespace}`, version: "0.0.0" },
    { capabilities: {} },
  );
  await client.connect(transport);

  return wrapSdkClient({
    namespace: input.namespace,
    displayName: input.displayName,
    sdkClient: client,
  });
}

/**
 * Connect to a remote HTTP/SSE MCP server and wrap it as a federated
 * client. The remote URL plus an auth header are stored in the
 * `blogkit_mcp_integrations` row; the framework adapter passes them in.
 */
export async function mountHttpClient(input: {
  namespace: string;
  displayName: string;
  url: string;
  headers?: Record<string, string>;
}): Promise<FederatedClient> {
  let sdk: any;
  let httpTransport: any;
  try {
    [sdk, httpTransport] = await Promise.all([
      import("@modelcontextprotocol/sdk/client/index.js" as string),
      import("@modelcontextprotocol/sdk/client/sse.js" as string),
    ]);
  } catch {
    throw new Error(
      "MCP federation requires @modelcontextprotocol/sdk.\n" +
        "Install with: npm install @modelcontextprotocol/sdk",
    );
  }

  const transport = new httpTransport.SSEClientTransport(new URL(input.url), {
    requestInit: { headers: input.headers ?? {} },
  });
  const client = new sdk.Client(
    { name: `@blogkit/federated/${input.namespace}`, version: "0.0.0" },
    { capabilities: {} },
  );
  await client.connect(transport);

  return wrapSdkClient({
    namespace: input.namespace,
    displayName: input.displayName,
    sdkClient: client,
  });
}

interface SdkClientLike {
  listTools(): Promise<{ tools: Array<Record<string, unknown>> }>;
  callTool(input: { name: string; arguments: Record<string, unknown> }): Promise<{
    content?: Array<Record<string, unknown>>;
    structuredContent?: unknown;
    isError?: boolean;
  }>;
  close(): Promise<void>;
}

function wrapSdkClient(input: {
  namespace: string;
  displayName: string;
  sdkClient: SdkClientLike;
}): FederatedClient {
  let cached: ToolSchema[] = [];

  return {
    namespace: input.namespace,
    displayName: input.displayName,
    get tools() {
      return cached;
    },
    async refreshTools() {
      const response = await input.sdkClient.listTools();
      cached = (response.tools ?? []).map((t) => ({
        name: String(t.name),
        description: typeof t.description === "string" ? t.description : "",
        scope: typeof t.scope === "string" && (t.scope === "write" || t.scope === "admin")
          ? (t.scope as ToolSchema["scope"])
          : "read",
        inputSchema: (t.inputSchema as ToolSchema["inputSchema"]) ?? {
          type: "object",
        },
      }));
      return cached;
    },
    async callTool(toolName, args) {
      try {
        const response = await input.sdkClient.callTool({
          name: toolName,
          arguments: args,
        });
        if (response.isError) {
          const text = pickText(response.content);
          return { ok: false, errorMessage: text ?? "child returned isError" };
        }
        return { ok: true, data: response.structuredContent ?? response.content };
      } catch (err) {
        return {
          ok: false,
          errorMessage: err instanceof Error ? err.message : String(err),
        };
      }
    },
    async close() {
      await input.sdkClient.close();
    },
  };
}

function pickText(content: Array<Record<string, unknown>> | undefined): string | null {
  if (!content || content.length === 0) return null;
  for (const item of content) {
    if (item.type === "text" && typeof item.text === "string") return item.text;
  }
  return null;
}
