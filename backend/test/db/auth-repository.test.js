import assert from "node:assert/strict";
import test from "node:test";
import { newDb } from "pg-mem";

import { runMigrations } from "../../src/db/migrate.js";
import { createAuthRepository } from "../../src/repositories/authRepository.js";

async function makeRepository() {
  const memoryDb = newDb();
  memoryDb.public.registerFunction({ name: "trim", args: ["text"], returns: "text", implementation: (value) => value.trim() });
  memoryDb.public.registerFunction({ name: "length", args: ["text"], returns: "integer", implementation: (value) => value.length });
  const { Pool } = memoryDb.adapters.createPg();
  const pool = new Pool();
  await runMigrations(pool);
  return { pool, repository: createAuthRepository(pool) };
}

test("registration creates an organizer, organization, and hashed session", async () => {
  const { pool, repository } = await makeRepository();
  const now = new Date("2026-10-05T12:00:00.000Z");
  const sessionTokenHash = "a".repeat(64);

  try {
    const account = await repository.registerOrganizer({
      name: "Ana Winata",
      email: "ANA@example.com",
      passwordHash: "scrypt$test-hash",
      organizationName: "Komunitas Terang",
      organizationType: "COMMUNITY",
      sessionTokenHash,
      sessionExpiresAt: new Date("2026-10-05T20:00:00.000Z"),
      now,
    });

    assert.equal(account.user.role, "ORGANIZER");
    assert.equal(account.user.email, "ana@example.com");
    assert.equal(account.organization.verified, false);
    assert.equal((await repository.findSessionUser(sessionTokenHash, now)).id, account.user.id);
    assert.equal(account.user.passwordHash, undefined);
  } finally {
    await pool.end();
  }
});

test("a session can be loaded by its hash and revoked without storing the token", async () => {
  const { pool, repository } = await makeRepository();
  const now = new Date("2026-10-05T12:00:00.000Z");
  const initialTokenHash = "a".repeat(64);
  const { user } = await repository.registerOrganizer({
    name: "Ana Winata",
    email: "ana@example.com",
    passwordHash: "scrypt$test-hash",
    organizationName: "Komunitas Terang",
    organizationType: "COMMUNITY",
    sessionTokenHash: initialTokenHash,
    sessionExpiresAt: new Date("2026-10-05T20:00:00.000Z"),
    now,
  });

  try {
    const tokenHash = "b".repeat(64);
    await repository.createSession({
      userId: user.id,
      tokenHash,
      expiresAt: new Date("2026-10-05T20:00:00.000Z"),
      now,
    });
    assert.equal((await repository.findSessionUser(tokenHash, now)).id, user.id);
    assert.equal(await repository.revokeSession(tokenHash, now), 1);
    assert.equal(await repository.findSessionUser(tokenHash, now), null);

    const stored = await pool.query("SELECT token_hash FROM user_sessions WHERE token_hash = $1", [tokenHash]);
    assert.equal(stored.rows[0].token_hash, tokenHash);
  } finally {
    await pool.end();
  }
});

test("session lookup rejects expired sessions and disabled accounts", async () => {
  const { pool, repository } = await makeRepository();
  const now = new Date("2026-10-05T12:00:00.000Z");
  const tokenHash = "d".repeat(64);
  try {
    const { user } = await repository.registerOrganizer({
      name: "Ana Winata",
      email: "ana@example.com",
      passwordHash: "scrypt$test-hash",
      organizationName: "Komunitas Terang",
      organizationType: "COMMUNITY",
      sessionTokenHash: tokenHash,
      sessionExpiresAt: new Date("2026-10-05T20:00:00.000Z"),
      now,
    });

    assert.equal(await repository.findSessionUser(tokenHash, new Date("2026-10-05T20:00:00.000Z")), null);
    await pool.query("UPDATE users SET status = 'DISABLED' WHERE id = $1", [user.id]);
    assert.equal(await repository.findSessionUser(tokenHash, now), null);
  } finally {
    await pool.end();
  }
});

test("registration issues a rollback when session insertion fails", async () => {
  const statements = [];
  let released = false;
  const client = {
    async query(sql) {
      const normalizedSql = sql.trim().replace(/\s+/g, " ");
      statements.push(normalizedSql);
      if (normalizedSql.startsWith("INSERT INTO user_sessions")) {
        throw Object.assign(new Error("duplicate session token hash"), { code: "23505" });
      }
      if (normalizedSql.startsWith("INSERT INTO organizations")) {
        return { rows: [{ id: "org-id", name: "Example Org", type: "COMMUNITY", verified: false }], rowCount: 1 };
      }
      if (normalizedSql.startsWith("INSERT INTO users")) {
        return {
          rows: [{ id: "user-id", name: "Ana", email_normalized: "ana@example.com", role: "ORGANIZER", organization_id: "org-id", status: "ACTIVE" }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    },
    release() {
      released = true;
    },
  };
  const repository = createAuthRepository({ connect: async () => client, query: async () => ({ rows: [], rowCount: 0 }) });

  await assert.rejects(repository.registerOrganizer({
    name: "Ana",
    email: "ana@example.com",
    passwordHash: "scrypt$test-hash",
    organizationName: "Example Org",
    organizationType: "COMMUNITY",
    sessionTokenHash: "e".repeat(64),
    sessionExpiresAt: new Date("2026-10-05T20:00:00.000Z"),
  }), { code: "23505" });
  assert.equal(statements[0], "BEGIN");
  assert.equal(statements.at(-1), "ROLLBACK");
  assert.equal(statements.includes("COMMIT"), false);
  assert.equal(released, true);
});

test("first-admin provisioning is one-time and creates an organization-free Admin", async () => {
  const { pool, repository } = await makeRepository();
  const now = new Date("2026-10-05T12:00:00.000Z");

  try {
    const first = await repository.createFirstAdmin({
      name: "System Admin",
      email: "admin@example.com",
      passwordHash: "scrypt$admin-hash",
      now,
    });
    assert.equal(first.user.role, "ADMIN");
    assert.equal(first.user.organizationId, null);
    await assert.rejects(repository.createFirstAdmin({
      name: "Second Admin",
      email: "second-admin@example.com",
      passwordHash: "scrypt$another-hash",
      now,
    }));
  } finally {
    await pool.end();
  }
});

test("concurrent first-admin provisioning cannot create multiple Admin accounts", async () => {
  const { pool, repository } = await makeRepository();
  try {
    const results = await Promise.allSettled([
      repository.createFirstAdmin({ name: "First Admin", email: "first@example.com", passwordHash: "first-hash" }),
      repository.createFirstAdmin({ name: "Second Admin", email: "second@example.com", passwordHash: "second-hash" }),
    ]);

    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal((await pool.query("SELECT id FROM users WHERE role = 'ADMIN'")).rowCount, 1);
  } finally {
    await pool.end();
  }
});

test("Admin role change is audited and revokes the target's active sessions", async () => {
  const { pool, repository } = await makeRepository();
  const now = new Date("2026-10-05T12:00:00.000Z");
  const sessionTokenHash = "c".repeat(64);

  try {
    const admin = await repository.createFirstAdmin({
      name: "System Admin",
      email: "admin@example.com",
      passwordHash: "scrypt$admin-hash",
      now,
    });
    const organizer = await repository.registerOrganizer({
      name: "Funder Candidate",
      email: "candidate@example.com",
      passwordHash: "scrypt$user-hash",
      organizationName: "Example Org",
      organizationType: "COMPANY",
      sessionTokenHash,
      sessionExpiresAt: new Date("2026-10-05T20:00:00.000Z"),
      now,
    });

    const updated = await repository.assignRoleAndAudit({
      actorUserId: admin.user.id,
      targetUserId: organizer.user.id,
      role: "FUNDER",
      now,
    });

    assert.equal(updated.role, "FUNDER");
    assert.equal(await repository.findSessionUser(sessionTokenHash, now), null);
    const audit = await pool.query("SELECT action FROM audit_logs WHERE entity_id = $1", [organizer.user.id]);
    assert.equal(audit.rows[0].action, "USER_ROLE_CHANGED");
    await assert.rejects(repository.assignRoleAndAudit({
      actorUserId: admin.user.id,
      targetUserId: admin.user.id,
      role: "ORGANIZER",
      now,
    }));
    await assert.rejects(repository.assignRoleAndAudit({
      actorUserId: admin.user.id,
      targetUserId: organizer.user.id,
      role: "ADMIN",
      now,
    }));
  } finally {
    await pool.end();
  }
});
