/**
 * `blogkit migrate` — apply pending SQL migrations against Supabase
 * Postgres (PRD §11.4).
 *
 * Strategy:
 *   - Reads `DATABASE_URL` from the env (the Postgres connection string
 *     from your Supabase project's Settings → Database).
 *   - Dynamically imports the `pg` driver. We don't take it as a hard
 *     dep so users who never run migrations don't pay the install cost;
 *     the CLI prompts to install it on first use.
 *   - Wraps each SQL file in a transaction. Records applied versions
 *     plus a checksum in `blogkit_migrations` so re-running is a no-op
 *     and post-hoc edits to applied files are caught.
 */
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { CliContext } from "./types.js";

const HERE = dirname(fileURLToPath(import.meta.url));

interface PgClientLike {
  connect(): Promise<void>;
  query(sql: string): Promise<{ rows: Array<Record<string, unknown>> }>;
  end(): Promise<void>;
}

export async function runMigrate(ctx: CliContext): Promise<number> {
  const dryRun = Boolean(ctx.flags["dry-run"]);
  const url = (ctx.flags.url as string | undefined) ?? process.env.DATABASE_URL;
  if (!url) {
    console.error(
      "Missing DATABASE_URL. Set it in .env.local or pass --url.\n" +
        "Find it in Supabase → Project Settings → Database → Connection String.",
    );
    return 1;
  }

  const dir = resolveMigrationsDir(ctx.flags["migrations-dir"] as string | undefined);
  if (!existsSync(dir)) {
    console.error(`Migrations directory not found: ${dir}`);
    return 1;
  }

  const files = (await readdir(dir))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  if (files.length === 0) {
    console.log("No migration files to run.");
    return 0;
  }

  if (dryRun) {
    console.log(`Would run ${files.length} migration(s) from ${dir}:`);
    for (const f of files) console.log(`  - ${f}`);
    return 0;
  }

  const client = await connectPg(url);
  if (!client) return 1;

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS blogkit_migrations (
        version    text PRIMARY KEY,
        checksum   text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      );
    `);

    const result = await client.query("SELECT version, checksum FROM blogkit_migrations");
    const applied = new Map<string, string>();
    for (const row of result.rows) {
      applied.set(String(row.version), String(row.checksum));
    }

    let appliedCount = 0;
    let skippedCount = 0;

    for (const file of files) {
      const version = file.replace(/\.sql$/, "");
      const sql = await readFile(join(dir, file), "utf8");
      const checksum = sha256Hex(sql);
      const previous = applied.get(version);

      if (previous) {
        if (previous !== checksum) {
          console.error(
            `\nMigration ${version} has been modified after it was applied.\n` +
              `  recorded checksum: ${previous}\n` +
              `  file checksum:     ${checksum}\n` +
              "Migrations are append-only — add a follow-up migration instead of editing.",
          );
          return 2;
        }
        skippedCount += 1;
        continue;
      }

      process.stdout.write(`→ ${version} ... `);
      const start = Date.now();
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          `INSERT INTO blogkit_migrations (version, checksum) VALUES ('${escapeSqlLiteral(version)}', '${checksum}')`,
        );
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        const message = err instanceof Error ? err.message : String(err);
        console.error(`failed.\n  ${message}`);
        return 3;
      }
      const ms = Date.now() - start;
      console.log(`applied (${ms}ms)`);
      appliedCount += 1;
    }

    console.log(
      `\nDone. ${appliedCount} applied, ${skippedCount} already up to date.`,
    );
    return 0;
  } finally {
    await client.end();
  }
}

async function connectPg(url: string): Promise<PgClientLike | null> {
  let pg: any;
  try {
    pg = await import("pg" as string);
  } catch {
    console.error(
      "The `pg` Postgres driver is required to run migrations.\n" +
        "Install it with: npm install --save-dev pg",
    );
    return null;
  }
  const PgClient = pg.Client ?? pg.default?.Client;
  if (!PgClient) {
    console.error("Imported `pg` but couldn't find a Client constructor.");
    return null;
  }
  const client = new PgClient({ connectionString: url });
  try {
    await client.connect();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Failed to connect to Postgres: ${message}`);
    return null;
  }
  return client as unknown as PgClientLike;
}

function resolveMigrationsDir(override?: string): string {
  if (override) return override;
  // Try the package's bundled migrations/ first…
  const bundled = join(HERE, "..", "..", "..", "supabase", "migrations");
  if (existsSync(bundled)) return bundled;
  // …then a sibling node_modules install.
  const installed = join(
    HERE,
    "..",
    "..",
    "..",
    "..",
    "@blogkit",
    "supabase",
    "migrations",
  );
  if (existsSync(installed)) return installed;
  // …and finally fall back to a project-local override.
  return join(process.cwd(), "supabase", "migrations");
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function escapeSqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}
