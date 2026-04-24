/**
 * `blogkit migrate` — apply pending SQL migrations against Supabase.
 *
 * Migrations live in `@blogkit/supabase/migrations/*.sql`. They are versioned,
 * up-only, and idempotent (re-running on the same database is safe — see
 * PRD §11.4). The runner records applied versions in a `blogkit_migrations`
 * table so subsequent invocations only apply newer files.
 */
import type { CliContext } from "./types.js";

export async function runMigrate(_ctx: CliContext): Promise<number> {
  console.log(
    "blogkit migrate — runner pending. Migrations are in @blogkit/supabase/migrations.",
  );
  return 0;
}
