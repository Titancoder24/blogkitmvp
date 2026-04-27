/**
 * `@blogkit/seo` — pure-function emitters for the BlogKit optimization
 * stack. Re-exports each module's surface so consumers can import either
 * `@blogkit/seo` or the focused subpaths (`@blogkit/seo/jsonld`, etc.).
 *
 * Everything in this package is framework-agnostic and side-effect free.
 * The framework adapters (`@blogkit/next`, …) are responsible for serving
 * the strings these functions return at the right routes.
 */
export * from "./jsonld.js";
export * from "./template-stack.js";
export * from "./collections.js";
export * from "./sitemap.js";
export * from "./robots.js";
export * from "./llms-txt.js";
export * from "./feeds.js";
export * from "./ai-plugin.js";
export * from "./openapi.js";
export * from "./c2pa.js";
