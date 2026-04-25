/**
 * `@blogkit/next` — Next.js (App Router 14+) adapter.
 *
 * Re-exports the Web-standard route handlers so consumers can wire them
 * into App Router files in one line each:
 *
 *   // app/sitemap.xml/route.ts
 *   import { sitemapHandler } from "@blogkit/next";
 *   import { adapter, config } from "@/lib/blogkit";
 *   export const GET = sitemapHandler({ adapter, config });
 *
 * Public rendering components (BlogIndex / BlogPost / TagPage / etc.)
 * land in week 2 of §12 alongside the theme system. The handlers ship
 * now so the SEO stack is end-to-end testable.
 */
export {
  aiPluginManifestHandler,
  atomHandler,
  collectionPageData,
  llmsFullTxtHandler,
  llmsTxtHandler,
  mcpHandler,
  robotsTxtHandler,
  rssHandler,
  sitemapHandler,
} from "./handlers.js";
export type { HandlerDependencies } from "./handlers.js";
