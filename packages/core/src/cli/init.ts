/**
 * `blogkit init` — the install entry point (PRD §4.1).
 *
 * Steps the full implementation will perform:
 *   1. Detect the framework via `package.json` and config files.
 *   2. Prompt for Supabase URL + service role key (or create a project via
 *      the Supabase Management API if the user gives an access token).
 *   3. Write `.env.local`.
 *   4. Run migrations (delegates to `runMigrate`).
 *   5. Create Storage buckets `blogkit-media` and `blogkit-uploads`.
 *   6. Configure Supabase Auth + create the first admin user.
 *   7. Inject framework routes (`/admin`, `/blog`, `/blog/[slug]`,
 *      `/sitemap.xml`, `/rss.xml`, `/atom.xml`, `/llms.txt`,
 *      `/llms-full.txt`, `/robots.txt`, `/.well-known/ai-plugin.json`).
 *   8. Write `blogkit.config.ts` at the project root.
 *   9. Print success URLs (public blog, admin, MCP endpoint).
 *
 * The 10-minute promise (PRD §4.2) is the test for whether this command
 * is shippable.
 */
import type { CliContext } from "./types.js";

export async function runInit(_ctx: CliContext): Promise<number> {
  console.log("blogkit init — scaffold pending (week 1 foundations).");
  console.log(
    "Will: detect framework, prompt for Supabase, run migrations, scaffold routes, write blogkit.config.ts.",
  );
  console.log("See PRD §4.1 for the full step list.");
  return 0;
}
