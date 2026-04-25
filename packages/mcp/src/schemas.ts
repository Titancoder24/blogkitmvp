/**
 * JSON Schema definitions for every MCP tool BlogKit exposes.
 *
 * MCP clients (Claude Code, Cursor, Gemini CLI, n8n) call `tools/list` to
 * discover the surface; these schemas are returned verbatim. We hand-write
 * them rather than generating from the TypeScript types because the
 * MCP-friendly shape often diverges from the storage shape (e.g. MCP
 * accepts `tags: string[]` of slugs while the adapter takes `tagIds`).
 */

export interface JsonSchema {
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: readonly string[];
  description?: string;
  default?: unknown;
  additionalProperties?: boolean | JsonSchema;
}

export interface ToolSchema {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  /** `read` tools require only a token with read scope. */
  scope: "read" | "write" | "admin";
}

export const TOOL_SCHEMAS: readonly ToolSchema[] = [
  {
    name: "list_posts",
    description:
      "List posts with optional filters (status, tag, category, author, date range). Returns up to `limit` posts ordered by `published_at` desc by default.",
    scope: "read",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["draft", "in_review", "scheduled", "published", "archived"],
          description: "Filter by post status.",
        },
        tag: { type: "string", description: "Filter by tag slug." },
        category: { type: "string", description: "Filter by category slug." },
        author_id: { type: "string", description: "Filter by author UUID." },
        published_since: {
          type: "string",
          description: "ISO 8601 inclusive lower bound on published_at.",
        },
        published_until: {
          type: "string",
          description: "ISO 8601 inclusive upper bound on published_at.",
        },
        limit: { type: "number", default: 25 },
        offset: { type: "number", default: 0 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_post",
    description: "Fetch a single post by slug or id, with author, tags, and citations.",
    scope: "read",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string" },
        id: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "search_posts",
    description: "Full-text search across published posts. Returns up to `limit` matches.",
    scope: "read",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Plain-text query." },
        limit: { type: "number", default: 10 },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "create_post",
    description:
      "Create a draft post. The slug is derived from the title if not provided. Returns the new post.",
    scope: "write",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        slug: { type: "string" },
        body_mdx: { type: "string", description: "Body in MDX/markdown." },
        excerpt: { type: "string" },
        tldr: { type: "string" },
        cover_image_url: { type: "string" },
        template_id: {
          type: "string",
          description:
            "One of: article, listicle, comparison, review, glossary, how-to, recipe, product, faq-hub, news, case-study, landing — or a custom template id.",
          default: "article",
        },
        author_id: { type: "string" },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Tag slugs. Unknown slugs are created on-the-fly.",
        },
      },
      required: ["title"],
      additionalProperties: false,
    },
  },
  {
    name: "update_post",
    description: "Update fields on an existing post. Returns the updated post.",
    scope: "write",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        body_mdx: { type: "string" },
        excerpt: { type: "string" },
        tldr: { type: "string" },
        cover_image_url: { type: "string" },
        template_id: { type: "string" },
        canonical_url: { type: "string" },
        custom_meta_title: { type: "string" },
        custom_meta_description: { type: "string" },
        noindex: { type: "boolean" },
        is_cornerstone: { type: "boolean" },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "publish_post",
    description: "Transition a post to `published`. Returns the published post.",
    scope: "write",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        published_at: {
          type: "string",
          description: "ISO 8601 publish timestamp. Defaults to now().",
        },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "schedule_post",
    description: "Schedule a post to publish at a future timestamp.",
    scope: "write",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        publish_at: { type: "string", description: "ISO 8601 future timestamp." },
      },
      required: ["id", "publish_at"],
      additionalProperties: false,
    },
  },
  {
    name: "archive_post",
    description: "Archive a post (it stops appearing in feeds and the public blog index).",
    scope: "write",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "list_tags",
    description: "List every tag.",
    scope: "read",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "list_categories",
    description: "List every category.",
    scope: "read",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "list_authors",
    description: "List every author.",
    scope: "read",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "list_templates",
    description:
      "List every template (built-in plus any custom templates created via the admin or v1.5 tool surface).",
    scope: "read",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_template",
    description: "Fetch a single template by id.",
    scope: "read",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "get_seo_report",
    description:
      "Run the live AI Visibility Score (six disciplines + aggregate, template-aware) against a post. Returns scores plus an ordered fix list.",
    scope: "read",
    inputSchema: {
      type: "object",
      properties: {
        post_id: { type: "string" },
        slug: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "list_revisions",
    description: "List the revision history for a post (most recent first).",
    scope: "read",
    inputSchema: {
      type: "object",
      properties: {
        post_id: { type: "string" },
        limit: { type: "number", default: 25 },
      },
      required: ["post_id"],
      additionalProperties: false,
    },
  },

  // ---------- v1.5: agent-driven tool/template authoring (PRD §19.2) ----------
  {
    name: "create_template",
    description:
      "Create a custom content template. Optionally fork an existing template to inherit its fields, blocks, and scoring rules. Validates inputs against Schema.org and field-type whitelists; emits one audit-log row.",
    scope: "admin",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Lowercase kebab-case, 2–40 chars." },
        name: { type: "string" },
        description: { type: "string" },
        base_template_id: {
          type: "string",
          description: "Optional id of an existing template to fork from.",
        },
        fields: {
          type: "array",
          items: { type: "object" },
          description: "Array of field specs (name, type, required?, options?, references?).",
        },
        blocks: {
          type: "array",
          items: { type: "string" },
          description: "Block kinds available in this template's editor palette.",
        },
        schema_mapping: {
          type: "object",
          description:
            "JSON-LD emission rules. Must include `type` from the Schema.org allow-list.",
        },
        scoring_rules: {
          type: "object",
          description:
            "Per-discipline weights (0–5) and required checks. Drives the AI Visibility Score for posts using this template.",
        },
        default_layout: {
          type: "object",
          description: "Optional default arrangement of blocks for new posts.",
        },
      },
      required: ["id", "name"],
      additionalProperties: false,
    },
  },
  {
    name: "update_template",
    description:
      "Update a custom template. Built-in templates are read-only — fork them via create_template instead.",
    scope: "admin",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        description: { type: "string" },
        fields: { type: "array", items: { type: "object" } },
        blocks: { type: "array", items: { type: "string" } },
        schema_mapping: { type: "object" },
        scoring_rules: { type: "object" },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "define_field",
    description:
      "Append a single field to a custom template. Convenience over update_template; agents typically add fields one at a time during a conversation.",
    scope: "admin",
    inputSchema: {
      type: "object",
      properties: {
        template_id: { type: "string" },
        name: { type: "string" },
        type: {
          type: "string",
          enum: [
            "text",
            "rich_text",
            "image",
            "number",
            "date",
            "select",
            "multi_select",
            "reference",
            "json",
          ],
        },
        required: { type: "boolean" },
        options: { type: "array", items: { type: "string" } },
        references: { type: "string" },
      },
      required: ["template_id", "name", "type"],
      additionalProperties: false,
    },
  },
  {
    name: "define_block",
    description:
      "Add or remove a block kind from a custom template's editor palette.",
    scope: "admin",
    inputSchema: {
      type: "object",
      properties: {
        template_id: { type: "string" },
        block: { type: "string" },
        action: { type: "string", enum: ["add", "remove"], default: "add" },
      },
      required: ["template_id", "block"],
      additionalProperties: false,
    },
  },
  {
    name: "define_schema_mapping",
    description:
      "Set JSON-LD emission rules for a custom template. The Schema.org `type` must come from the allow-list (validated server-side to keep Rich Results valid).",
    scope: "admin",
    inputSchema: {
      type: "object",
      properties: {
        template_id: { type: "string" },
        type: { type: "string" },
      },
      required: ["template_id", "type"],
      additionalProperties: true,
    },
  },
  {
    name: "define_scoring_rule",
    description:
      "Set the per-discipline weights and required checks for a custom template. Weights are bounded to [0, 5].",
    scope: "admin",
    inputSchema: {
      type: "object",
      properties: {
        template_id: { type: "string" },
        scoring_rules: {
          type: "object",
          description:
            "Object with `weights: { seo, aeo, geo, aio, llmo, agentSeo }` and optional `requires` map.",
        },
      },
      required: ["template_id", "scoring_rules"],
      additionalProperties: false,
    },
  },
];
