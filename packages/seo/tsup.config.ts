import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/jsonld.ts",
    "src/sitemap.ts",
    "src/robots.ts",
    "src/llms-txt.ts",
    "src/feeds.ts",
  ],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "node18",
  splitting: false,
  external: ["@blogkit/core"],
});
