import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/adapter.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "node18",
  splitting: false,
  external: ["@supabase/supabase-js", "@blogkit/core"],
});
