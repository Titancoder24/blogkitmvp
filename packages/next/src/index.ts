/**
 * `@blogkit/next` — Next.js (App Router 14+) adapter.
 *
 * Implementation lands in week 2 of §12 (public rendering — Next.js first).
 * The mount surface this package will provide:
 *
 *   - `installBlogKit({ config })`              add routes to a Next app
 *   - <BlogIndex />, <BlogPost />               public route components
 *   - sitemap / rss / atom / llms.txt route handlers
 *   - /api/mcp route handler bound to @blogkit/mcp HTTP transport
 *   - /.well-known/ai-plugin.json manifest
 *   - middleware that adds the recommended security and AI-friendliness
 *     response headers (no Cloudflare Bot Fight Mode, no JS-only content)
 *
 * Until the implementation lands, importing from this package is a no-op.
 */
export {};
