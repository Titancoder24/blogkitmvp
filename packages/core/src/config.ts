/**
 * `defineConfig` — the typed entry point for `blogkit.config.ts` (PRD §10.1).
 *
 * Users write a partial config; this fills in defaults so everything downstream
 * (renderer, MCP server, SEO emitters) can rely on a fully populated shape.
 */
import type {
  AiConfig,
  McpConfig,
  OrganizationConfig,
  ResolvedBlogKitConfig,
  RoutesConfig,
  SeoConfig,
  SiteConfig,
} from "./types.js";

export interface BlogKitUserConfig {
  site: SiteConfig;
  organization?: Partial<OrganizationConfig> & Pick<OrganizationConfig, "name">;
  storage?: { provider?: "supabase"; bucket?: string };
  database?: { provider?: "supabase" };
  routes?: Partial<RoutesConfig>;
  seo?: Partial<SeoConfig>;
  ai?: Partial<AiConfig>;
  mcp?: Partial<McpConfig>;
  theme?: string;
}

/**
 * Defaults are tuned for the "10-minute promise" (PRD §4.2): a developer
 * who answers nothing beyond the site URL gets correct SEO/AEO/GEO output.
 */
export const DEFAULT_CONFIG: Omit<ResolvedBlogKitConfig, "site" | "organization"> = {
  storage: { provider: "supabase", bucket: "blogkit-media" },
  database: { provider: "supabase" },
  routes: { admin: "/admin", blog: "/blog" },
  seo: {
    defaultSchemaType: "BlogPosting",
    enforceCitations: true,
    minCitations: 3,
    publishThreshold: 70,
  },
  ai: {
    allowedCrawlers: "all",
    llmsTxtMaxLinks: 50,
    freshnessWarningDays: 14,
  },
  mcp: { enabled: true, mountPath: "/api/mcp" },
  theme: "pragma",
};

export function defineConfig(
  config: BlogKitUserConfig,
): ResolvedBlogKitConfig {
  const organization: OrganizationConfig = {
    name: config.organization?.name ?? config.site.name,
    logoUrl: config.organization?.logoUrl,
    sameAs: config.organization?.sameAs ?? [],
  };

  return {
    site: config.site,
    organization,
    storage: { ...DEFAULT_CONFIG.storage, ...config.storage },
    database: { ...DEFAULT_CONFIG.database, ...config.database },
    routes: { ...DEFAULT_CONFIG.routes, ...config.routes },
    seo: { ...DEFAULT_CONFIG.seo, ...config.seo },
    ai: { ...DEFAULT_CONFIG.ai, ...config.ai },
    mcp: { ...DEFAULT_CONFIG.mcp, ...config.mcp },
    theme: config.theme ?? DEFAULT_CONFIG.theme,
  };
}
