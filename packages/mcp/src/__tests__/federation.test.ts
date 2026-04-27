import { describe, expect, it } from "vitest";
import {
  createFederator,
  type FederatedClient,
} from "../federation.js";
import type { ToolSchema } from "../schemas.js";

function fakeClient(opts: {
  namespace: string;
  displayName?: string;
  tools: ToolSchema[];
  call?: (name: string, args: Record<string, unknown>) => Promise<unknown>;
}): FederatedClient {
  let cached = opts.tools;
  return {
    namespace: opts.namespace,
    displayName: opts.displayName ?? opts.namespace,
    get tools() {
      return cached;
    },
    async refreshTools() {
      return cached;
    },
    async callTool(name, args) {
      if (!opts.call) return { ok: true, data: { name, args } };
      try {
        const data = await opts.call(name, args);
        return { ok: true, data };
      } catch (err) {
        return {
          ok: false,
          errorMessage: err instanceof Error ? err.message : String(err),
        };
      }
    },
    async close() {
      cached = [];
    },
  };
}

describe("createFederator", () => {
  it("namespaces child tools and merges them with the local catalog", () => {
    const fed = createFederator();
    fed.mount(
      fakeClient({
        namespace: "notion",
        displayName: "Notion",
        tools: [
          {
            name: "search_pages",
            description: "Search Notion pages.",
            scope: "read",
            inputSchema: { type: "object" },
          },
        ],
      }),
    );
    const catalog = fed.catalog();
    expect(catalog).toHaveLength(1);
    expect(catalog[0]?.name).toBe("notion__search_pages");
    expect(catalog[0]?.description).toContain("[Notion]");
  });

  it("routes namespaced tool calls to the right child", () => {
    const fed = createFederator();
    fed.mount(
      fakeClient({
        namespace: "drive",
        tools: [
          {
            name: "list_files",
            description: "x",
            scope: "read",
            inputSchema: { type: "object" },
          },
        ],
      }),
    );
    const route = fed.route("drive__list_files");
    expect(route?.client.namespace).toBe("drive");
    expect(route?.localName).toBe("list_files");
  });

  it("returns null for non-namespaced tool names", () => {
    const fed = createFederator();
    expect(fed.route("local_tool")).toBeNull();
  });

  it("rejects duplicate namespace mounts", () => {
    const fed = createFederator();
    fed.mount(fakeClient({ namespace: "n", tools: [] }));
    expect(() =>
      fed.mount(fakeClient({ namespace: "n", tools: [] })),
    ).toThrow(/already mounted/);
  });

  it("unmount closes the child", async () => {
    const fed = createFederator();
    let closed = false;
    fed.mount({
      ...fakeClient({ namespace: "x", tools: [] }),
      async close() {
        closed = true;
      },
    });
    await fed.unmount("x");
    expect(closed).toBe(true);
    expect(fed.list()).toHaveLength(0);
  });
});
