# `@blogkit/core`

The agent-native, SEO-maximal headless CMS for React meta-frameworks.

One command installs it, points it at a Supabase project, and gives any team a production blog with admin UI, image storage, and every modern search-optimization layer (SEO + AEO + GEO + LLM-SEO + Agent-SEO) baked in by default — zero configuration required.

## Status

This branch (`claude/blogkit-core-setup-o941f`) lays down the foundations from §12 — Week 1 of the build plan in the PRD:

- Monorepo workspace
- Database schema + RLS policies (Supabase / Postgres)
- Shared TypeScript types
- Supabase adapter interface (provider-bound for v1.1+ Firebase / Mongo / etc.)
- Pure-function SEO emitters (`@blogkit/seo`): JSON-LD, sitemap, robots, llms.txt
- CLI skeleton (`init`, `migrate`, `doctor`, `mcp-serve`)
- Stubs for the framework adapters, admin, editor, MCP server

Subsequent weeks fill in the public rendering, admin UI, block editor, live scoring panel, themes, templates, and MCP server.

## Workspace layout

```
packages/
  core/        # framework-detecting installer, shared types, CLI, defineConfig
  supabase/    # Supabase adapter (DB + Storage + Auth) and SQL migrations
  seo/         # pure functions: JSON-LD, sitemap, robots, llms.txt
  mcp/         # MCP server (stdio + HTTP/SSE)
  admin/       # admin React app (framework-agnostic)
  editor/      # block-based MDX editor with live preview + scoring panel
  next/        # Next.js (App Router 14+) adapter
  remix/       # Remix (v2+) adapter
  astro/       # Astro (5+) adapter
```

## Quick start (target UX, not yet wired)

```bash
npx @blogkit/core init
```

The CLI detects the host framework, prompts for Supabase credentials, runs migrations, scaffolds routes, and prints the public blog URL plus the admin URL plus the MCP server endpoint. The 10-minute promise: from `init` to a published, AI-citable post in under 10 minutes.

## License

MIT.
