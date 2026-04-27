import type { Post, ResolvedBlogKitConfig } from "@blogkit/core/types";
import { describe, expect, it } from "vitest";
import {
  buildProvenanceManifest,
  canonicalJson,
  signManifest,
  type Signer,
} from "../c2pa.js";
import { buildOpenApiSpec } from "../openapi.js";

const CONFIG: ResolvedBlogKitConfig = {
  site: { name: "Acme", url: "https://acme.example", tagline: "Notes" },
  organization: { name: "Acme Inc.", sameAs: [] },
  storage: { provider: "supabase", bucket: "media" },
  database: { provider: "supabase" },
  routes: { admin: "/admin", blog: "/blog" },
  seo: {
    defaultSchemaType: "BlogPosting",
    enforceCitations: true,
    minCitations: 3,
    publishThreshold: 70,
  },
  ai: { allowedCrawlers: "all", llmsTxtMaxLinks: 50, freshnessWarningDays: 14 },
  mcp: { enabled: true, mountPath: "/api/mcp" },
  theme: "pragma",
};

describe("buildOpenApiSpec", () => {
  it("emits a 3.1 spec with one operation per tool", () => {
    const spec = buildOpenApiSpec({
      config: CONFIG,
      tools: [
        {
          name: "list_posts",
          description: "List posts.",
          scope: "read",
          inputSchema: { type: "object" },
        },
        {
          name: "create_post",
          description: "Create a post.",
          scope: "write",
          inputSchema: { type: "object" },
        },
      ],
    });
    expect(spec.openapi).toBe("3.1.0");
    const paths = spec.paths as Record<string, Record<string, unknown>>;
    expect(paths["/api/tools/list_posts"]).toBeDefined();
    expect(paths["/api/tools/create_post"]).toBeDefined();
    expect(paths["/api/mcp"]).toBeDefined();
    expect(((spec.components as any).securitySchemes.bearerAuth.type)).toBe("http");
  });

  it("tags content/taxonomy/seo/templates correctly", () => {
    const spec = buildOpenApiSpec({
      config: CONFIG,
      tools: [
        { name: "list_tags", description: "x", scope: "read", inputSchema: { type: "object" } },
        { name: "list_templates", description: "x", scope: "read", inputSchema: { type: "object" } },
        { name: "audit_site", description: "x", scope: "read", inputSchema: { type: "object" } },
        { name: "list_posts", description: "x", scope: "read", inputSchema: { type: "object" } },
      ],
    });
    const paths = spec.paths as Record<string, any>;
    expect(paths["/api/tools/list_tags"].post.tags).toEqual(["taxonomy"]);
    expect(paths["/api/tools/list_templates"].post.tags).toEqual(["templates"]);
    expect(paths["/api/tools/audit_site"].post.tags).toEqual(["seo"]);
    expect(paths["/api/tools/list_posts"].post.tags).toEqual(["content"]);
  });
});

describe("canonicalJson", () => {
  it("sorts keys alphabetically at every depth", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalJson({ a: { c: 1, b: 2 }, d: [1, 2] })).toBe(
      '{"a":{"b":2,"c":1},"d":[1,2]}',
    );
  });
  it("drops undefined fields", () => {
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
  });
});

describe("buildProvenanceManifest + signManifest", () => {
  function makePost(): Pick<
    Post,
    "publishedAt" | "lastRefreshedAt" | "createdAt" | "updatedAt" | "bodyMdx"
  > {
    return {
      bodyMdx: "BlogKit ships every SEO artifact by default.",
      createdAt: "2026-04-01T00:00:00Z",
      updatedAt: "2026-04-25T00:00:00Z",
      publishedAt: "2026-04-20T00:00:00Z",
      lastRefreshedAt: "2026-04-25T00:00:00Z",
    };
  }

  it("hashes the body, lists actions, and asserts training-mining stance", async () => {
    const manifest = await buildProvenanceManifest({
      post: makePost(),
      ctx: {
        author: { name: "Jane", website: "https://jane.dev", sameAs: [] },
        productionTool: "BlogKit/0.0.0",
        siteDomain: "acme.example",
        postUrl: "https://acme.example/blog/hello",
      },
    });
    expect(manifest.algorithm).toBe("ed25519");
    expect(manifest.body_hash).toMatch(/^[0-9a-f]{64}$/);

    const actionsAssertion = manifest.assertions.find(
      (a) => a.label === "c2pa.actions",
    ) as any;
    expect(actionsAssertion.data.actions.map((a: any) => a.action)).toEqual([
      "c2pa.created",
      "c2pa.published",
      "c2pa.edited",
    ]);

    const training = manifest.assertions.find(
      (a) => a.label === "c2pa.training-mining",
    ) as any;
    expect(training.data.entries).toContainEqual({
      use: "ai_generative_training",
      constraint_info: "Disallowed by publisher.",
    });
  });

  it("signManifest produces a deterministic signature for a given signer", async () => {
    const manifest = await buildProvenanceManifest({
      post: makePost(),
      ctx: {
        productionTool: "BlogKit/0.0.0",
        siteDomain: "acme.example",
        postUrl: "https://acme.example/blog/hello",
      },
    });
    const signer: Signer = {
      algorithm: "ed25519",
      keyId: "test-key",
      async sign(payload) {
        // Deterministic stub: digest of the payload (not real Ed25519,
        // but proves signManifest passes through canonical bytes).
        const digest = await crypto.subtle.digest("SHA-256", payload);
        return new Uint8Array(digest);
      },
    };
    const a = await signManifest(manifest, signer);
    const b = await signManifest(manifest, signer);
    expect(a.signature).toBe(b.signature);
    expect(a.key_id).toBe("test-key");
  });
});
