import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Root vitest config. Aliases workspace packages to their source so tests
 * can run without a prior `pnpm build` — every package imports from
 * `@blogkit/core/types` etc., and we want those to resolve to the live
 * `src/` files, not the (possibly stale) `dist/` output.
 */
const r = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@blogkit/core/types": r("./packages/core/src/types.ts"),
      "@blogkit/core/config": r("./packages/core/src/config.ts"),
      "@blogkit/core": r("./packages/core/src/index.ts"),
      "@blogkit/seo": r("./packages/seo/src/index.ts"),
      "@blogkit/scoring": r("./packages/scoring/src/index.ts"),
      "@blogkit/intelligence": r("./packages/intelligence/src/index.ts"),
      "@blogkit/supabase/adapter": r("./packages/supabase/src/adapter.ts"),
      "@blogkit/supabase": r("./packages/supabase/src/index.ts"),
      "@blogkit/mcp": r("./packages/mcp/src/index.ts"),
    },
  },
  test: {
    include: ["packages/*/src/**/__tests__/**/*.test.ts"],
    environment: "node",
    globals: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
    },
  },
});
