import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/jsonld.ts",
    "src/template-stack.ts",
    "src/collections.ts",
    "src/sitemap.ts",
    "src/robots.ts",
    "src/llms-txt.ts",
    "src/feeds.ts",
    "src/ai-plugin.ts",
  ],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "node18",
  splitting: false,
  external: ["@blogkit/core"],
});
