import { Pool } from "pg";

export function createPool(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error("DATABASE_URL is required for PostgreSQL");
  const pool = new Pool({
    connectionString,
    max: 10,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
  });
  pool.on("error", (err) => {
    console.error("PostgreSQL pool idle client error:", err.message);
  });
  return pool;
}
