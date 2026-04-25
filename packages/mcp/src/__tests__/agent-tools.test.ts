import type { Template } from "@blogkit/core/types";
import type { BlogKitAdapter } from "@blogkit/supabase/adapter";
import { beforeEach, describe, expect, it } from "vitest";
import { agentHandlers } from "../agent-tools.js";
import { dispatch } from "../router.js";
import type { HandlerContext } from "../handlers.js";

// ---------- in-memory adapter (template + audit only) ----------
function memoryAdapter(initial: Template[] = []): BlogKitAdapter {
  const templates = new Map<string, Template>();
  for (const t of initial) templates.set(t.id, t);
  const audit: Array<Record<string, unknown>> = [];

  const stub = {
    list: async () => Array.from(templates.values()),
    getById: async (id: string) => templates.get(id) ?? null,
    create: async (input: Omit<Template, "createdAt" | "updatedAt">) => {
      if (templates.has(input.id)) throw new Error("duplicate");
      const created: Template = {
        ...input,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      templates.set(input.id, created);
      return created;
    },
    update: async (id: string, patch: Partial<Template>) => {
      const current = templates.get(id);
      if (!current) throw new Error("not found");
      const updated: Template = {
        ...current,
        ...patch,
        id: current.id,
        updatedAt: new Date().toISOString(),
      };
      templates.set(id, updated);
      return updated;
    },
    delete: async (id: string) => {
      templates.delete(id);
    },
  };

  return {
    templates: stub,
    audit: {
      record: async (entry) => {
        audit.push(entry as Record<string, unknown>);
      },
      list: async () => [],
    },
    // Other adapters are untouched by agent-tools tests; cast to any.
  } as unknown as BlogKitAdapter & { __audit: Array<Record<string, unknown>> };
}

function ctx(adapter: BlogKitAdapter): HandlerContext {
  return { adapter, actorType: "mcp_token", actorId: "tok_test" };
}

const ARTICLE: Template = {
  id: "article",
  name: "Article",
  isBuiltIn: true,
  fields: [],
  blocks: ["paragraph", "heading"],
  schemaMapping: { type: "BlogPosting" },
  scoringRules: { weights: { seo: 1, aeo: 1, geo: 1, aio: 1, llmo: 1, agentSeo: 1 } },
  createdAt: "x",
  updatedAt: "x",
};

describe("agentHandlers.create_template", () => {
  let adapter: BlogKitAdapter;
  beforeEach(() => {
    adapter = memoryAdapter([ARTICLE]);
  });

  it("forks an existing template and inherits its fields/blocks/rules", async () => {
    const result = await agentHandlers.create_template(ctx(adapter), {
      id: "podcast-episode",
      name: "Podcast Episode",
      base_template_id: "article",
      schema_mapping: { type: "PodcastEpisode" },
      fields: [
        { name: "episode_number", type: "number", required: true },
        { name: "transcript", type: "rich_text" },
      ],
    });
    expect(result.id).toBe("podcast-episode");
    expect(result.isBuiltIn).toBe(false);
    expect(result.schemaMapping).toEqual({ type: "PodcastEpisode" });
    expect(result.fields.map((f) => f.name)).toEqual([
      "episode_number",
      "transcript",
    ]);
  });

  it("rejects an invalid id", async () => {
    await expect(
      agentHandlers.create_template(ctx(adapter), {
        id: "Bad ID!",
        name: "x",
      }),
    ).rejects.toThrow(/Invalid id/);
  });

  it("rejects a duplicate id", async () => {
    await expect(
      agentHandlers.create_template(ctx(adapter), {
        id: "article",
        name: "Article (dup)",
      }),
    ).rejects.toThrow(/already exists/);
  });

  it("rejects a Schema.org type outside the allow-list", async () => {
    await expect(
      agentHandlers.create_template(ctx(adapter), {
        id: "made-up",
        name: "Made up",
        schema_mapping: { type: "FictitiousType" },
      }),
    ).rejects.toThrow(/schema_mapping\.type/);
  });

  it("rejects field types outside the allow-list", async () => {
    await expect(
      agentHandlers.create_template(ctx(adapter), {
        id: "x",
        name: "x",
        fields: [{ name: "bad", type: "binary" }],
      }),
    ).rejects.toThrow(/type/);
  });
});

describe("agentHandlers.update_template", () => {
  it("refuses to mutate a built-in template", async () => {
    const adapter = memoryAdapter([ARTICLE]);
    await expect(
      agentHandlers.update_template(ctx(adapter), {
        id: "article",
        name: "Article (forked)",
      }),
    ).rejects.toThrow(/built-in/);
  });

  it("updates a custom template", async () => {
    const adapter = memoryAdapter([ARTICLE]);
    await agentHandlers.create_template(ctx(adapter), {
      id: "podcast",
      name: "Podcast",
      schema_mapping: { type: "PodcastEpisode" },
    });
    const updated = await agentHandlers.update_template(ctx(adapter), {
      id: "podcast",
      name: "Podcast (v2)",
      blocks: ["paragraph", "heading", "embed"],
    });
    expect(updated.name).toBe("Podcast (v2)");
    expect(updated.blocks).toContain("embed");
  });
});

describe("agentHandlers.define_field / define_block", () => {
  let adapter: BlogKitAdapter;
  beforeEach(async () => {
    adapter = memoryAdapter([ARTICLE]);
    await agentHandlers.create_template(ctx(adapter), {
      id: "podcast",
      name: "Podcast",
      schema_mapping: { type: "PodcastEpisode" },
    });
  });

  it("appends a field", async () => {
    const result = await agentHandlers.define_field(ctx(adapter), {
      template_id: "podcast",
      name: "guest_name",
      type: "text",
      required: true,
    });
    expect(result.fields.map((f) => f.name)).toContain("guest_name");
  });

  it("rejects duplicate field names", async () => {
    await agentHandlers.define_field(ctx(adapter), {
      template_id: "podcast",
      name: "guest_name",
      type: "text",
    });
    await expect(
      agentHandlers.define_field(ctx(adapter), {
        template_id: "podcast",
        name: "guest_name",
        type: "text",
      }),
    ).rejects.toThrow(/duplicate field/);
  });

  it("adds and removes blocks idempotently", async () => {
    const added = await agentHandlers.define_block(ctx(adapter), {
      template_id: "podcast",
      block: "embed",
      action: "add",
    });
    expect(added.blocks).toContain("embed");
    const removed = await agentHandlers.define_block(ctx(adapter), {
      template_id: "podcast",
      block: "embed",
      action: "remove",
    });
    expect(removed.blocks).not.toContain("embed");
  });

  it("rejects unknown block kinds", async () => {
    await expect(
      agentHandlers.define_block(ctx(adapter), {
        template_id: "podcast",
        block: "fake-block",
      }),
    ).rejects.toThrow(/unknown block kind/);
  });
});

describe("agentHandlers.define_scoring_rule", () => {
  it("rejects weights outside [0, 5]", async () => {
    const adapter = memoryAdapter([ARTICLE]);
    await agentHandlers.create_template(ctx(adapter), {
      id: "podcast",
      name: "Podcast",
      schema_mapping: { type: "PodcastEpisode" },
    });
    await expect(
      agentHandlers.define_scoring_rule(ctx(adapter), {
        template_id: "podcast",
        scoring_rules: { weights: { geo: 99 } },
      }),
    ).rejects.toThrow(/weights\.geo/);
  });
});

describe("router scope enforcement", () => {
  it("requires admin scope to call create_template", async () => {
    const adapter = memoryAdapter([ARTICLE]);
    const result = await dispatch(
      ctx(adapter),
      "create_template",
      { id: "podcast", name: "Podcast" },
      { scope: "write" },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("scope_denied");
  });

  it("admin scope is allowed", async () => {
    const adapter = memoryAdapter([ARTICLE]);
    const result = await dispatch(
      ctx(adapter),
      "create_template",
      {
        id: "podcast",
        name: "Podcast",
        schema_mapping: { type: "PodcastEpisode" },
      },
      { scope: "admin" },
    );
    expect(result.ok).toBe(true);
  });

  it("surfaces invalid_args from the handler", async () => {
    const adapter = memoryAdapter([ARTICLE]);
    const result = await dispatch(
      ctx(adapter),
      "create_template",
      { id: "BAD" },
      { scope: "admin" },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid_args");
  });
});
