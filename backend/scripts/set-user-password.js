import "dotenv/config";
import { hashPassword } from "../src/auth/passwords.js";
import { createPool } from "../src/db/pool.js";

async function main() {
  const hash = await hashPassword("ComSci1234567");
  const pool = createPool(process.env.DATABASE_URL);
  try {
    const res = await pool.query(
      "UPDATE users SET password_hash = $1 WHERE email_normalized = $2",
      [hash, "comsci@gmail.com"]
    );
    console.log(`Updated user comsci@gmail.com password to ComSci1234567: ${res.rowCount} row(s) updated.`);
  } finally {
    await pool.end();
  }
}

main().catch(console.error);
