import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/stdio.ts", "src/http.ts", "src/federation.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "node18",
  splitting: false,
  external: [
    "@blogkit/core",
    "@blogkit/intelligence",
    "@blogkit/scoring",
    "@blogkit/seo",
    "@blogkit/supabase",
    "@modelcontextprotocol/sdk",
  ],
});
