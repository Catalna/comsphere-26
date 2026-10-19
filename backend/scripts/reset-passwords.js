import "dotenv/config";
import { hashPassword } from "../src/auth/passwords.js";
import { createPool } from "../src/db/pool.js";

async function main() {
  const hash = await hashPassword("Danaterang#Local2026");
  const pool = createPool(process.env.DATABASE_URL);
  try {
    const res = await pool.query("UPDATE users SET password_hash = $1", [hash]);
    console.log(`Updated ${res.rowCount} users with standard password.`);
  } finally {
    await pool.end();
  }
}

main().catch(console.error);
