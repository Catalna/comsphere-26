import "dotenv/config";

import { createPool } from "../src/db/pool.js";
import { runMigrations } from "../src/db/migrate.js";

let pool;
try {
  pool = createPool();
  const applied = await runMigrations(pool);
  console.log(applied.length === 0
    ? "No database migrations pending."
    : `Applied ${applied.length} database migration(s).`);
} catch {
  console.error("Database migration failed. Check DATABASE_URL and database availability.");
  process.exitCode = 1;
} finally {
  await pool?.end();
}
