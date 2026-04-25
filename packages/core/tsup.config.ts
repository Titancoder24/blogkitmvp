import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    types: "src/types.ts",
    config: "src/config.ts",
    "cli/index": "src/cli/index.ts",
  },
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "node18",
  splitting: false,
  shims: false,
  external: [
    "@blogkit/seo",
    "@blogkit/supabase",
    "@blogkit/mcp",
    "@supabase/supabase-js",
    "pg",
  ],
});
