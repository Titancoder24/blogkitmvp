import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2022",
  splitting: false,
  external: [
    "@remix-run/node",
    "@remix-run/react",
    "react",
    "react-dom",
    "@blogkit/admin",
    "@blogkit/core",
    "@blogkit/mcp",
    "@blogkit/seo",
    "@blogkit/supabase",
  ],
});
