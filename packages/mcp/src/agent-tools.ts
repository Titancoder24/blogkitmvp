/**
 * Agent-driven tool / template / block creation handlers (PRD §19.2).
 *
 * Lets an MCP agent extend BlogKit at runtime: define a new content
 * template, add or remove fields, change schema emission rules, tweak
 * scoring weights. The first concrete v1.5 surface that turns BlogKit
 * from a CMS into an adaptive content platform.
 *
 * Safety model (PRD §19.5):
 *   - Every handler runs strict JSON-schema-style validation on its
 *     input. Invalid payloads are rejected before any DB write.
 *   - Every successful write emits one row to `audit_log` with the
 *     full payload, the actor identity (token id), and the action.
 *   - Templates are versioned via the `revisions` table for content
 *     and via JSON snapshots in audit_log for templates themselves —
 *     a one-click revert is straightforward.
 *   - Approval-gating is a config flag. By default, write/admin tokens
 *     can create templates directly; admins can require human approval
 *     per token in the admin UI.
 */
import type { Template, TemplateFieldSpec, TemplateId } from "@blogkit/core/types";
import type { HandlerContext } from "./handlers.js";

// ---------- whitelists ----------
/**
 * Schema.org types we permit in agent-created `schema_mapping.type`.
 * Anything outside this list is rejected: an agent can't invent a
 * fictitious schema and have BlogKit emit invalid JSON-LD that breaks
 * Rich Results validation.
 */
const ALLOWED_SCHEMA_TYPES: ReadonlySet<string> = new Set([
  "Article",
  "BlogPosting",
  "NewsArticle",
  "TechArticle",
  "Recipe",
  "HowTo",
  "Review",
  "Product",
  "FAQPage",
  "DefinedTerm",
  "DefinedTermSet",
  "ItemList",
  "CollectionPage",
  "WebPage",
  "Book",
  "Course",
  "PodcastEpisode",
  "Event",
  "VideoObject",
  "MusicAlbum",
  "Movie",
  "TVEpisode",
  "Game",
  "SoftwareApplication",
  "Organization",
  "Person",
  "Place",
]);

const ALLOWED_FIELD_TYPES: ReadonlySet<TemplateFieldSpec["type"]> = new Set([
  "text",
  "rich_text",
  "image",
  "number",
  "date",
  "select",
  "multi_select",
  "reference",
  "json",
]);

const ALLOWED_BLOCKS: ReadonlySet<string> = new Set([
  "paragraph",
  "heading",
  "image",
  "callout",
  "code",
  "citation",
  "faq",
  "tldr",
  "statistic",
  "quote",
  "listicle-item",
  "comparison-row",
  "ingredient",
  "instruction-step",
  "rating",
  "spec-row",
  "pros-cons",
  "definition",
  "example",
  "step",
  "metric",
  "timeline",
  "before-after",
  "hero",
  "feature-grid",
  "testimonial",
  "pricing",
  "cta",
  "embed",
]);

const TEMPLATE_ID_RE = /^[a-z][a-z0-9-]{1,40}$/;

// ---------- agent tool handlers ----------
export const agentHandlers = {
  /**
   * Create a brand-new template, optionally forking from an existing one.
   * Built-in templates (`article`, `recipe`, …) cannot be created here —
   * they're seeded by the SQL migrations and protected by `is_built_in`.
   */
  async create_template(
    ctx: HandlerContext,
    args: Record<string, unknown>,
  ): Promise<Template> {
    const id = mustString(args.id, "id");
    if (!TEMPLATE_ID_RE.test(id)) {
      throw invalid("id", "must be lowercase kebab-case, 2–40 chars");
    }
    const existing = await ctx.adapter.templates.getById(id);
    if (existing) throw invalid("id", `template '${id}' already exists`);

    const baseId = optString(args.base_template_id, "base_template_id");
    const base = baseId ? await ctx.adapter.templates.getById(baseId) : null;
    if (baseId && !base) throw invalid("base_template_id", `'${baseId}' not found`);

    const fields = parseFields(args.fields ?? base?.fields ?? []);
    const blocks = parseBlocks(args.blocks ?? base?.blocks ?? ["paragraph", "heading"]);
    const schemaMapping = parseSchemaMapping(
      args.schema_mapping ?? base?.schemaMapping ?? { type: "BlogPosting" },
    );
    const scoringRules = parseScoringRules(
      args.scoring_rules ?? base?.scoringRules ?? {},
    );

    const created = await ctx.adapter.templates.create({
      id,
      name: mustString(args.name, "name"),
      description: optString(args.description, "description"),
      isBuiltIn: false,
      fields,
      blocks,
      schemaMapping,
      scoringRules,
      defaultLayout: (args.default_layout as Record<string, unknown> | undefined) ?? undefined,
    });

    await ctx.adapter.audit.record({
      actorType: ctx.actorType,
      actorId: ctx.actorId,
      action: "template.create",
      targetType: "template",
      targetId: id,
      payload: { source: baseId ? `forked from ${baseId}` : "blank", fields, blocks },
    });
    return created;
  },

  /**
   * Update fields, blocks, schema mapping, or scoring rules on an
   * existing template. Built-in templates are read-only here — to
   * customize them, agents must `create_template` with `base_template_id`.
   */
  async update_template(
    ctx: HandlerContext,
    args: Record<string, unknown>,
  ): Promise<Template> {
    const id = mustString(args.id, "id");
    const current = await ctx.adapter.templates.getById(id);
    if (!current) throw invalid("id", `template '${id}' not found`);
    if (current.isBuiltIn) {
      throw invalid("id", "built-in templates are read-only; fork via create_template");
    }

    const patch: Partial<Template> = {};
    if (args.name !== undefined) patch.name = mustString(args.name, "name");
    if (args.description !== undefined) {
      patch.description = optString(args.description, "description");
    }
    if (args.fields !== undefined) patch.fields = parseFields(args.fields);
    if (args.blocks !== undefined) patch.blocks = parseBlocks(args.blocks);
    if (args.schema_mapping !== undefined) {
      patch.schemaMapping = parseSchemaMapping(args.schema_mapping);
    }
    if (args.scoring_rules !== undefined) {
      patch.scoringRules = parseScoringRules(args.scoring_rules);
    }

    const updated = await ctx.adapter.templates.update(id, patch);
    await ctx.adapter.audit.record({
      actorType: ctx.actorType,
      actorId: ctx.actorId,
      action: "template.update",
      targetType: "template",
      targetId: id,
      payload: patch,
    });
    return updated;
  },

  /**
   * Append a single field to an existing custom template. Convenience
   * over `update_template` because agents tend to add fields one at a
   * time during a conversation.
   */
  async define_field(
    ctx: HandlerContext,
    args: Record<string, unknown>,
  ): Promise<Template> {
    const templateId = mustString(args.template_id, "template_id");
    const current = await assertEditable(ctx, templateId);
    const field = parseFieldSpec(args);
    if (current.fields.some((f) => f.name === field.name)) {
      throw invalid("name", `field '${field.name}' already exists on '${templateId}'`);
    }
    const fields = [...current.fields, field];
    const updated = await ctx.adapter.templates.update(templateId, { fields });
    await ctx.adapter.audit.record({
      actorType: ctx.actorType,
      actorId: ctx.actorId,
      action: "template.field.add",
      targetType: "template",
      targetId: templateId,
      payload: field,
    });
    return updated;
  },

  /**
   * Add or remove a block kind from a template's editor palette.
   */
  async define_block(
    ctx: HandlerContext,
    args: Record<string, unknown>,
  ): Promise<Template> {
    const templateId = mustString(args.template_id, "template_id");
    const block = mustString(args.block, "block");
    if (!ALLOWED_BLOCKS.has(block)) {
      throw invalid("block", `unknown block kind '${block}'`);
    }
    const action = (args.action as string | undefined) ?? "add";
    if (action !== "add" && action !== "remove") {
      throw invalid("action", "must be 'add' or 'remove'");
    }
    const current = await assertEditable(ctx, templateId);
    const set = new Set(current.blocks);
    if (action === "add") set.add(block);
    else set.delete(block);
    const updated = await ctx.adapter.templates.update(templateId, {
      blocks: [...set],
    });
    await ctx.adapter.audit.record({
      actorType: ctx.actorType,
      actorId: ctx.actorId,
      action: `template.block.${action}`,
      targetType: "template",
      targetId: templateId,
      payload: { block },
    });
    return updated;
  },

  /**
   * Set the JSON-LD emission rules for a template. The agent picks one
   * of the whitelisted Schema.org types and provides a property → field
   * mapping; the SEO orchestrator reads this when emitting JSON-LD.
   */
  async define_schema_mapping(
    ctx: HandlerContext,
    args: Record<string, unknown>,
  ): Promise<Template> {
    const templateId = mustString(args.template_id, "template_id");
    const mapping = parseSchemaMapping(args);
    await assertEditable(ctx, templateId);
    const updated = await ctx.adapter.templates.update(templateId, {
      schemaMapping: mapping,
    });
    await ctx.adapter.audit.record({
      actorType: ctx.actorType,
      actorId: ctx.actorId,
      action: "template.schema-mapping.set",
      targetType: "template",
      targetId: templateId,
      payload: mapping,
    });
    return updated;
  },

  /**
   * Set or update a scoring rule on a template. Each rule maps a
   * discipline to a weight and optional required-checks. The aggregate
   * geo-mean reads `weights`; the per-template required checks plug
   * into the discipline scorers via the `requires` map.
   */
  async define_scoring_rule(
    ctx: HandlerContext,
    args: Record<string, unknown>,
  ): Promise<Template> {
    const templateId = mustString(args.template_id, "template_id");
    const current = await assertEditable(ctx, templateId);
    const rules = parseScoringRules(args.scoring_rules ?? current.scoringRules);
    const updated = await ctx.adapter.templates.update(templateId, {
      scoringRules: rules,
    });
    await ctx.adapter.audit.record({
      actorType: ctx.actorType,
      actorId: ctx.actorId,
      action: "template.scoring.set",
      targetType: "template",
      targetId: templateId,
      payload: rules,
    });
    return updated;
  },
} satisfies Record<
  string,
  (ctx: HandlerContext, args: Record<string, unknown>) => Promise<unknown>
>;

// ---------- input parsing ----------
function parseFields(input: unknown): TemplateFieldSpec[] {
  if (!Array.isArray(input)) {
    throw invalid("fields", "must be an array of field specs");
  }
  const out: TemplateFieldSpec[] = [];
  const names = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== "object" || raw === null) {
      throw invalid("fields[]", "each field must be an object");
    }
    const spec = parseFieldSpec(raw as Record<string, unknown>);
    if (names.has(spec.name)) {
      throw invalid("fields[].name", `duplicate field '${spec.name}'`);
    }
    names.add(spec.name);
    out.push(spec);
  }
  return out;
}

function parseFieldSpec(raw: Record<string, unknown>): TemplateFieldSpec {
  const name = mustString(raw.name, "name");
  if (!/^[a-z][a-zA-Z0-9_]{0,40}$/.test(name)) {
    throw invalid("name", "must start with a lowercase letter; alphanumeric + underscore");
  }
  const type = mustString(raw.type, "type") as TemplateFieldSpec["type"];
  if (!ALLOWED_FIELD_TYPES.has(type)) {
    throw invalid("type", `unknown field type '${type}'`);
  }
  const out: TemplateFieldSpec = { name, type };
  if (raw.required !== undefined) out.required = Boolean(raw.required);
  if (raw.options !== undefined) {
    if (!Array.isArray(raw.options)) {
      throw invalid("options", "must be an array of strings");
    }
    out.options = raw.options.map((o) => String(o));
  }
  if (raw.references !== undefined) out.references = String(raw.references);
  return out;
}

function parseBlocks(input: unknown): string[] {
  if (!Array.isArray(input)) {
    throw invalid("blocks", "must be an array of block names");
  }
  const out: string[] = [];
  for (const raw of input) {
    const block = String(raw);
    if (!ALLOWED_BLOCKS.has(block)) {
      throw invalid("blocks[]", `unknown block kind '${block}'`);
    }
    out.push(block);
  }
  return [...new Set(out)];
}

function parseSchemaMapping(input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null) {
    throw invalid("schema_mapping", "must be an object");
  }
  const obj = input as Record<string, unknown>;
  const type = obj.type;
  if (typeof type !== "string" || !ALLOWED_SCHEMA_TYPES.has(type)) {
    throw invalid(
      "schema_mapping.type",
      `must be one of: ${[...ALLOWED_SCHEMA_TYPES].sort().join(", ")}`,
    );
  }
  return obj;
}

function parseScoringRules(input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null) {
    throw invalid("scoring_rules", "must be an object");
  }
  const rules = input as Record<string, unknown>;
  const weights = rules.weights as Record<string, unknown> | undefined;
  if (weights !== undefined) {
    for (const [key, value] of Object.entries(weights)) {
      if (typeof value !== "number" || value < 0 || value > 5) {
        throw invalid(
          `scoring_rules.weights.${key}`,
          "must be a number in [0, 5]",
        );
      }
    }
  }
  return rules;
}

async function assertEditable(
  ctx: HandlerContext,
  templateId: TemplateId,
): Promise<Template> {
  const current = await ctx.adapter.templates.getById(templateId);
  if (!current) throw invalid("template_id", `template '${templateId}' not found`);
  if (current.isBuiltIn) {
    throw invalid(
      "template_id",
      "built-in templates are read-only; fork via create_template",
    );
  }
  return current;
}

function mustString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw invalid(name, "is required");
  }
  return value.trim();
}

function optString(value: unknown, name: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw invalid(name, "must be a string");
  return value.trim() || undefined;
}

function invalid(field: string, reason: string): Error {
  return Object.assign(new Error(`Invalid ${field}: ${reason}`), {
    code: "invalid_args",
  });
}
