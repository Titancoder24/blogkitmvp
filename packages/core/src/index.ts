/**
 * `@blogkit/core` — public entry point.
 *
 * Re-exports the type surface and `defineConfig`. Framework adapters
 * (`@blogkit/next`, `@blogkit/remix`, `@blogkit/astro`) consume these
 * directly; userland imports `defineConfig` from this entry to author
 * `blogkit.config.ts`.
 */
export * from "./types.js";
export { defineConfig, DEFAULT_CONFIG } from "./config.js";
export type { BlogKitUserConfig } from "./config.js";
