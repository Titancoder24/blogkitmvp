/**
 * `@blogkit/supabase` — Supabase implementation of `BlogKitAdapter`.
 *
 * The interface lives at `./adapter` so future provider packages
 * (`@blogkit/firebase`, `@blogkit/mongo`, …) can import the same
 * contract without depending on Supabase.
 *
 * The actual Supabase implementation (`createSupabaseAdapter`) is wired
 * up in week 1 alongside the database migrations and lands in this file.
 * This scaffold exports the adapter surface so dependents can already
 * type-check against it.
 */
export * from "./adapter.js";

export { MIGRATIONS_PATH, MIGRATION_FILES } from "./migrations.js";
