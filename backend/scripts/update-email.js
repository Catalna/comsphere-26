import "dotenv/config";
import { createPool } from "../src/db/pool.js";

async function main() {
  const pool = createPool(process.env.DATABASE_URL);
  try {
    const res = await pool.query(
      "UPDATE users SET email_normalized = $1 WHERE email_normalized = $2",
      ["comsci@gmail.com", "comscie@gmail.com"]
    );
    console.log(`Updated email from comscie@gmail.com to comsci@gmail.com: ${res.rowCount} row(s) updated.`);
  } finally {
    await pool.end();
  }
}

main().catch(console.error);
