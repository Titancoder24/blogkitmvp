/**
 * `blogkit doctor` — full diagnostic (PRD §4.3).
 *
 * Checks:
 *   - env vars present and well-formed
 *   - Supabase reachable; tables and storage buckets exist
 *   - robots.txt allows the documented AI crawlers
 *   - llms.txt is reachable and parses
 *   - JSON-LD on a sample published post validates against Schema.org
 *   - Open Graph tags present
 *   - Lighthouse SEO ≥ 95 on a sample post URL
 *
 * Each failure prints a one-line fix. Exit code is non-zero if any required
 * check fails.
 */
import type { CliContext } from "./types.js";

export async function runDoctor(_ctx: CliContext): Promise<number> {
  console.log("blogkit doctor — checks pending. See PRD §4.3 for the list.");
  return 0;
}
