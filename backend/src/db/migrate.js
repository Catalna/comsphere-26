import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_MIGRATIONS_DIRECTORY = fileURLToPath(new URL("../../../database/migrations/", import.meta.url));
const UP_MIGRATION_PATTERN = /^(\d+_[a-z0-9_]+)\.sql$/;

async function migrationFiles(directory) {
  const names = await readdir(directory);
  return names
    .map((name) => ({ name, match: UP_MIGRATION_PATTERN.exec(name) }))
    .filter(({ match }) => match !== null)
    .sort((left, right) => left.name.localeCompare(right.name));
}

async function inTransaction(pool, operation) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Keep the original failure; the pool/client will be discarded by its owner if needed.
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function runMigrations(pool, directory = DEFAULT_MIGRATIONS_DIRECTORY) {
  let migrationTableExists = true;
  try {
    await pool.query("SELECT migration_id FROM schema_migrations LIMIT 0");
  } catch {
    migrationTableExists = false;
  }
  if (!migrationTableExists) {
    await pool.query(`
      CREATE TABLE schema_migrations (
        migration_id TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL
      )
    `);
  }

  const applied = [];
  for (const { name, match } of await migrationFiles(directory)) {
    const migrationId = match[1];
    const existing = await pool.query(
      "SELECT migration_id FROM schema_migrations WHERE migration_id = $1",
      [migrationId],
    );
    if (existing.rowCount > 0) continue;

    const sql = await readFile(join(directory, name), "utf8");
    await inTransaction(pool, async (client) => {
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (migration_id, applied_at) VALUES ($1, $2)", [migrationId, new Date()]);
    });
    applied.push(migrationId);
  }
  return applied;
}

export async function rollbackLastMigration(pool, directory = DEFAULT_MIGRATIONS_DIRECTORY) {
  const result = await pool.query("SELECT migration_id FROM schema_migrations ORDER BY migration_id DESC LIMIT 1");
  if (result.rowCount === 0) return null;

  const migrationId = result.rows[0].migration_id;
  const sql = await readFile(join(directory, `${migrationId}.down.sql`), "utf8");
  await inTransaction(pool, async (client) => {
    await client.query(sql);
    await client.query("DELETE FROM schema_migrations WHERE migration_id = $1", [migrationId]);
  });
  return migrationId;
}
