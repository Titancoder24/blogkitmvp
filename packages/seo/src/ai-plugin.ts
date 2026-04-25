/**
 * `/.well-known/ai-plugin.json` manifest (PRD §6.7).
 *
 * Declares site capabilities to AI agents that follow the OpenAPI plugin
 * protocol. This is one of the things BlogKit emits automatically that
 * almost no other CMS does.
 *
 * Spec reference: https://platform.openai.com/docs/plugins/getting-started/openapi-definition
 * — mirrored by Anthropic, Perplexity, and the W3C WebMCP draft for
 * capability discovery.
 */
import type { OrganizationConfig, SiteConfig } from "@blogkit/core/types";

export interface AiPluginManifest {
  schema_version: "v1";
  name_for_human: string;
  name_for_model: string;
  description_for_human: string;
  description_for_model: string;
  auth: { type: "none" | "user_http" | "service_http" } | { type: "oauth" };
  api: { type: "openapi"; url: string };
  /** MCP endpoint URL — the BlogKit-specific discovery extension. */
  mcp?: { type: "mcp"; url: string };
  logo_url?: string;
  contact_email?: string;
  legal_info_url?: string;
}

export interface BuildAiPluginManifestOptions {
  site: SiteConfig;
  organization: OrganizationConfig;
  /** Path the host serves the OpenAPI spec at. Defaults to `/openapi.json`. */
  openapiPath?: string;
  /** Path the host mounts the MCP HTTP transport at. Defaults to `/api/mcp`. */
  mcpPath?: string | null;
  contactEmail?: string;
  legalInfoPath?: string;
}

export function buildAiPluginManifest(
  opts: BuildAiPluginManifestOptions,
): AiPluginManifest {
  const base = opts.site.url.replace(/\/+$/, "");
  const manifest: AiPluginManifest = {
    schema_version: "v1",
    name_for_human: opts.site.name,
    name_for_model: slugify(opts.site.name),
    description_for_human:
      opts.site.tagline ??
      `${opts.site.name} blog — content searchable, citable, and operable by AI agents.`,
    description_for_model:
      `Use the BlogKit MCP endpoint or the OpenAPI spec to list, search, ` +
      `read, and (with a write-scoped token) author posts on ${opts.site.name}. ` +
      `The site emits Schema.org JSON-LD on every post and exposes an llms.txt ` +
      `index for single-fetch ingestion.`,
    auth: { type: "service_http" },
    api: { type: "openapi", url: `${base}${opts.openapiPath ?? "/openapi.json"}` },
    logo_url: opts.organization.logoUrl,
    contact_email: opts.contactEmail,
    legal_info_url: opts.legalInfoPath ? `${base}${opts.legalInfoPath}` : undefined,
  };
  if (opts.mcpPath !== null) {
    manifest.mcp = { type: "mcp", url: `${base}${opts.mcpPath ?? "/api/mcp"}` };
  }
  return pruneUndefined(manifest) as AiPluginManifest;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

function pruneUndefined<T extends Record<string, unknown>>(input: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}
