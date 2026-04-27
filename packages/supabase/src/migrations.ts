/**
 * Versioned, ordered migration files. The CLI's `migrate` command runs these
 * in order against the configured Supabase project (PRD §11.4).
 *
 * Adding a migration:
 *   1. Drop a new file in `packages/supabase/migrations/` named
 *      `NNNN_description.sql` where NNNN is the next zero-padded number.
 *   2. Append its filename to `MIGRATION_FILES` below.
 *   3. Make it idempotent — every statement should tolerate re-running.
 */

export const MIGRATIONS_PATH = "migrations";

export const MIGRATION_FILES = [
  "0001_initial_schema.sql",
  "0002_rls_policies.sql",
  "0003_seed_templates.sql",
  "0004_storage_buckets.sql",
  "0005_v11_features.sql",
] as const;

export type MigrationFile = (typeof MIGRATION_FILES)[number];
