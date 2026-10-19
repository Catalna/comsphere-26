import assert from "node:assert/strict";
import test from "node:test";
import { newDb } from "pg-mem";

import { verifyPassword } from "../../src/auth/passwords.js";
import { runMigrations } from "../../src/db/migrate.js";
import { provisionAdmin } from "../../scripts/provision-admin.js";

const environment = {
  DATABASE_URL: "postgres://test:test@localhost:5432/dana_terang",
  BOOTSTRAP_ADMIN_NAME: "Initial Admin",
  BOOTSTRAP_ADMIN_EMAIL: "admin@example.com",
  BOOTSTRAP_ADMIN_PASSWORD: "a strong bootstrap password",
};

async function makePoolFactory() {
  const memoryDb = newDb();
  memoryDb.public.registerFunction({ name: "trim", args: ["text"], returns: "text", implementation: (value) => value.trim() });
  memoryDb.public.registerFunction({ name: "length", args: ["text"], returns: "integer", implementation: (value) => value.length });
  const { Pool } = memoryDb.adapters.createPg();
  const initialPool = new Pool();
  await runMigrations(initialPool);
  await initialPool.end();
  return () => new Pool();
}

test("Admin bootstrap persists a password hash and returns no credential material", async () => {
  const poolFactory = await makePoolFactory();
  const created = await provisionAdmin({ env: environment, poolFactory });

  assert.equal(created.user.email, "admin@example.com");
  assert.equal(created.user.role, "ADMIN");
  assert.equal("passwordHash" in created.user, false);
  assert.equal("password" in created.user, false);

  const pool = poolFactory();
  try {
    const stored = await pool.query("SELECT password_hash FROM users WHERE email_normalized = $1", ["admin@example.com"]);
    assert.notEqual(stored.rows[0].password_hash, environment.BOOTSTRAP_ADMIN_PASSWORD);
    assert.equal(await verifyPassword(environment.BOOTSTRAP_ADMIN_PASSWORD, stored.rows[0].password_hash), true);
  } finally {
    await pool.end();
  }
});

test("Admin bootstrap refuses incomplete configuration before opening a database", async () => {
  let opened = false;
  await assert.rejects(
    provisionAdmin({ env: { ...environment, BOOTSTRAP_ADMIN_PASSWORD: "" }, poolFactory: () => { opened = true; } }),
    { code: "INVALID_BOOTSTRAP_CONFIGURATION" },
  );
  await assert.rejects(
    provisionAdmin({ env: { ...environment, DATABASE_URL: "   " }, poolFactory: () => { opened = true; } }),
    { code: "INVALID_BOOTSTRAP_CONFIGURATION" },
  );
  assert.equal(opened, false);
});

test("Admin bootstrap is one-time even when invoked again", async () => {
  const poolFactory = await makePoolFactory();
  await provisionAdmin({ env: environment, poolFactory });
  await assert.rejects(
    provisionAdmin({ env: environment, poolFactory }),
    { code: "ADMIN_ALREADY_EXISTS" },
  );
});
