import assert from "node:assert/strict";
import test from "node:test";
import request from "supertest";
import { newDb } from "pg-mem";

import { createApp } from "../../src/app.js";
import { hashPassword } from "../../src/auth/passwords.js";
import { TERMS_VERSION } from "../../src/auth/validation.js";
import { runMigrations } from "../../src/db/migrate.js";
import { createAuthRepository } from "../../src/repositories/authRepository.js";

const WEB_ORIGIN = "http://localhost:3000";

async function createTestApp({ nodeEnv = "test" } = {}) {
  const memoryDb = newDb();
  memoryDb.public.registerFunction({ name: "trim", args: ["text"], returns: "text", implementation: (value) => value.trim() });
  memoryDb.public.registerFunction({ name: "length", args: ["text"], returns: "integer", implementation: (value) => value.length });
  const { Pool } = memoryDb.adapters.createPg();
  const pool = new Pool();
  await runMigrations(pool);
  const repository = createAuthRepository(pool);
  return { app: createApp({ authRepository: repository, webOrigin: WEB_ORIGIN, nodeEnv }), pool, repository };
}

const organizerInput = {
  name: "Ana Winata",
  email: "ana@example.com",
  password: "correct horse battery staple",
  organizationName: "Komunitas Terang",
  organizationType: "COMMUNITY",
  acceptedTermsVersion: TERMS_VERSION,
};

function sessionCookie(response) {
  const cookie = response.headers["set-cookie"]?.find((value) => value.startsWith("dt_session="));
  assert.ok(cookie, "response should set the session cookie");
  return cookie.split(";")[0];
}

test("public registration creates only an Organizer account and a private session cookie", async () => {
  const { app, pool } = await createTestApp();
  try {
    const response = await request(app)
      .post("/api/auth/register")
      .set("Origin", WEB_ORIGIN)
      .send(organizerInput);

    assert.equal(response.status, 201);
    assert.equal(response.body.user.role, "ORGANIZER");
    assert.equal(response.body.user.email, "ana@example.com");
    assert.equal(response.body.user.organization.verified, false);
    assert.equal("passwordHash" in response.body.user, false);
    assert.equal("token" in response.body, false);
    assert.match(sessionCookie(response), /^dt_session=/);
    assert.match(response.headers["set-cookie"][0], /HttpOnly/);
    assert.match(response.headers["set-cookie"][0], /SameSite=Lax/);
    assert.match(response.headers["set-cookie"][0], /Max-Age=28800/);
    assert.equal(response.headers["set-cookie"][0].includes("Secure"), false);
    assert.equal(response.headers["access-control-allow-origin"], WEB_ORIGIN);
    assert.equal(response.headers["access-control-allow-credentials"], "true");
    assert.equal(response.headers["cache-control"], "no-store");

    const stored = await pool.query("SELECT role, password_hash FROM users WHERE email_normalized = $1", ["ana@example.com"]);
    assert.equal(stored.rows[0].role, "ORGANIZER");
    assert.notEqual(stored.rows[0].password_hash, organizerInput.password);
  } finally {
    await pool.end();
  }
});

test("registration rejects client-selected roles and mismatched origins", async () => {
  const { app, pool } = await createTestApp();
  try {
    const roleInjection = await request(app)
      .post("/api/auth/register")
      .set("Origin", WEB_ORIGIN)
      .send({ ...organizerInput, role: "ADMIN" });
    assert.equal(roleInjection.status, 400);
    assert.deepEqual(roleInjection.body, { error: "invalid_request" });

    const malformedFields = await request(app)
      .post("/api/auth/register")
      .set("Origin", WEB_ORIGIN)
      .send({ ...organizerInput, name: 42 });
    assert.equal(malformedFields.status, 400);
    assert.deepEqual(malformedFields.body, { error: "invalid_request" });

    const wrongOrigin = await request(app)
      .post("/api/auth/register")
      .set("Origin", "https://attacker.example")
      .send(organizerInput);
    assert.equal(wrongOrigin.status, 403);
    assert.equal(wrongOrigin.headers["access-control-allow-origin"], undefined);
    assert.equal((await pool.query("SELECT id FROM users")).rowCount, 0);
  } finally {
    await pool.end();
  }
});

test("duplicate normalized emails return a generic conflict", async () => {
  const { app, pool } = await createTestApp();
  try {
    const first = await request(app).post("/api/auth/register").set("Origin", WEB_ORIGIN).send(organizerInput);
    assert.equal(first.status, 201);

    const duplicate = await request(app)
      .post("/api/auth/register")
      .set("Origin", WEB_ORIGIN)
      .send({ ...organizerInput, email: " ANA@EXAMPLE.COM " });
    assert.equal(duplicate.status, 409);
    assert.deepEqual(duplicate.body, { error: "account_unavailable" });
    assert.equal((await pool.query("SELECT id FROM users")).rowCount, 1);
  } finally {
    await pool.end();
  }
});

test("login errors are generic and logout revokes the session", async () => {
  const { app, pool } = await createTestApp();
  try {
    const registration = await request(app).post("/api/auth/register").set("Origin", WEB_ORIGIN).send(organizerInput);
    assert.equal(registration.status, 201);

    const badPassword = await request(app)
      .post("/api/auth/login")
      .set("Origin", WEB_ORIGIN)
      .send({ email: organizerInput.email, password: "wrong password" });
    const missingUser = await request(app)
      .post("/api/auth/login")
      .set("Origin", WEB_ORIGIN)
      .send({ email: "missing@example.com", password: "wrong password" });
    assert.equal(badPassword.status, 401);
    assert.deepEqual(badPassword.body, { error: "invalid_credentials" });
    assert.deepEqual(missingUser.body, badPassword.body);

    const login = await request(app)
      .post("/api/auth/login")
      .set("Origin", WEB_ORIGIN)
      .send({ email: organizerInput.email, password: organizerInput.password });
    assert.equal(login.status, 200);
    const cookie = sessionCookie(login);
    const me = await request(app).get("/api/auth/me").set("Cookie", cookie).set("Origin", WEB_ORIGIN);
    assert.equal(me.body.user.role, "ORGANIZER");
    assert.equal(me.headers["cache-control"], "no-store");
    assert.equal(me.body.user.organization.name, organizerInput.organizationName);
    assert.equal("passwordHash" in me.body.user, false);
    assert.equal("sessionTokenHash" in me.body.user, false);

    const logout = await request(app).post("/api/auth/logout").set("Cookie", cookie).set("Origin", WEB_ORIGIN);
    assert.equal(logout.status, 204);
    assert.match(logout.headers["set-cookie"][0], /HttpOnly/);
    const afterLogout = await request(app).get("/api/auth/me").set("Cookie", cookie).set("Origin", WEB_ORIGIN);
    assert.equal(afterLogout.status, 401);
    assert.equal((await pool.query("SELECT revoked_at FROM user_sessions WHERE revoked_at IS NOT NULL")).rowCount, 1);
  } finally {
    await pool.end();
  }
});

test("only Admin can assign Funder or Verifier roles", async () => {
  const { app, pool, repository } = await createTestApp();
  try {
    const registration = await request(app).post("/api/auth/register").set("Origin", WEB_ORIGIN).send(organizerInput);
    assert.equal(registration.status, 201);
    const adminPassword = "secure admin password 123";
    await repository.createFirstAdmin({
      name: "System Admin",
      email: "admin@example.com",
      passwordHash: await hashPassword(adminPassword),
    });

    const organizerLogin = await request(app)
      .post("/api/auth/login")
      .set("Origin", WEB_ORIGIN)
      .send({ email: organizerInput.email, password: organizerInput.password });
    const organizerRoleChange = await request(app)
      .patch(`/api/admin/users/${organizerLogin.body.user.id}/role`)
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", sessionCookie(organizerLogin))
      .send({ role: "FUNDER" });
    assert.equal(organizerRoleChange.status, 403);

    const adminLogin = await request(app)
      .post("/api/auth/login")
      .set("Origin", WEB_ORIGIN)
      .send({ email: "admin@example.com", password: adminPassword });
    const target = await repository.findUserByEmail(organizerInput.email);
    const change = await request(app)
      .patch(`/api/admin/users/${target.id}/role`)
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", sessionCookie(adminLogin))
      .send({ role: "VERIFIER" });
    assert.equal(change.status, 200);
    assert.equal(change.body.user.role, "VERIFIER");
    assert.equal((await pool.query("SELECT action FROM audit_logs WHERE entity_id = $1", [target.id])).rows[0].action, "USER_ROLE_CHANGED");

    const adminRoleChange = await request(app)
      .patch(`/api/admin/users/${adminLogin.body.user.id}/role`)
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", sessionCookie(adminLogin))
      .send({ role: "ORGANIZER" });
    assert.equal(adminRoleChange.status, 403);

    const makeAnotherAdmin = await request(app)
      .patch(`/api/admin/users/${target.id}/role`)
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", sessionCookie(adminLogin))
      .send({ role: "ADMIN" });
    assert.equal(makeAnotherAdmin.status, 400);
  } finally {
    await pool.end();
  }
});

test("only an authenticated Admin can list users", async () => {
  const { app, pool, repository } = await createTestApp();
  try {
    const registration = await request(app).post("/api/auth/register").set("Origin", WEB_ORIGIN).send(organizerInput);
    assert.equal(registration.status, 201);
    const adminPassword = "secure admin password 123";
    await repository.createFirstAdmin({
      name: "System Admin",
      email: "admin@example.com",
      passwordHash: await hashPassword(adminPassword),
    });

    const unauthenticated = await request(app).get("/api/admin/users");
    assert.equal(unauthenticated.status, 401);

    const organizerLogin = await request(app)
      .post("/api/auth/login")
      .set("Origin", WEB_ORIGIN)
      .send({ email: organizerInput.email, password: organizerInput.password });
    const organizerResponse = await request(app)
      .get("/api/admin/users")
      .set("Cookie", sessionCookie(organizerLogin));
    assert.equal(organizerResponse.status, 403);

    const adminLogin = await request(app)
      .post("/api/auth/login")
      .set("Origin", WEB_ORIGIN)
      .send({ email: "admin@example.com", password: adminPassword });
    const response = await request(app).get("/api/admin/users").set("Cookie", sessionCookie(adminLogin));
    assert.equal(response.status, 200);
    assert.equal(response.headers["cache-control"], "no-store");
    assert.ok(Array.isArray(response.body.users));
  } finally {
    await pool.end();
  }
});

test("Admin user listings never expose password or session secrets", async () => {
  const { app, pool, repository } = await createTestApp();
  try {
    const registration = await request(app).post("/api/auth/register").set("Origin", WEB_ORIGIN).send(organizerInput);
    assert.equal(registration.status, 201);
    const adminPassword = "secure admin password 123";
    await repository.createFirstAdmin({
      name: "System Admin",
      email: "admin@example.com",
      passwordHash: await hashPassword(adminPassword),
    });
    const adminLogin = await request(app)
      .post("/api/auth/login")
      .set("Origin", WEB_ORIGIN)
      .send({ email: "admin@example.com", password: adminPassword });

    const response = await request(app).get("/api/admin/users").set("Cookie", sessionCookie(adminLogin));
    assert.equal(response.status, 200);
    assert.ok(Array.isArray(response.body.users));
    const organizer = response.body.users.find((user) => user.email === organizerInput.email);
    assert.deepEqual(Object.keys(organizer).sort(), ["email", "id", "name", "organization", "organizationId", "role"]);
    assert.equal("passwordHash" in organizer, false);
    assert.equal("sessionTokenHash" in organizer, false);
    assert.equal(JSON.stringify(response.body).includes("correct horse battery staple"), false);
  } finally {
    await pool.end();
  }
});

test("production session cookies are Secure", async () => {
  const { app, pool } = await createTestApp({ nodeEnv: "production" });
  try {
    const response = await request(app)
      .post("/api/auth/register")
      .set("Origin", WEB_ORIGIN)
      .send(organizerInput);
    assert.equal(response.status, 201);
    assert.match(response.headers["set-cookie"][0], /; Secure/);
  } finally {
    await pool.end();
  }
});

test("registration and login are rate-limited per IP", async () => {
  const { app, pool } = await createTestApp();
  try {
    const registrations = await Promise.all(Array.from({ length: 6 }, () => request(app)
      .post("/api/auth/register")
      .set("Origin", WEB_ORIGIN)
      .send({})));
    assert.deepEqual(registrations.slice(0, 5).map((response) => response.status), [400, 400, 400, 400, 400]);
    assert.equal(registrations[5].status, 429);

    const logins = await Promise.all(Array.from({ length: 11 }, () => request(app)
      .post("/api/auth/login")
      .set("Origin", WEB_ORIGIN)
      .send({})));
    assert.deepEqual(logins.slice(0, 10).map((response) => response.status), Array(10).fill(400));
    assert.equal(logins[10].status, 429);
  } finally {
    await pool.end();
  }
});

test("only an Admin can list organizations and update their verification", async () => {
  const { app, pool, repository } = await createTestApp();
  try {
    const registration = await request(app).post("/api/auth/register").set("Origin", WEB_ORIGIN).send(organizerInput);
    assert.equal(registration.status, 201);
    const organizationId = registration.body.user.organizationId;
    const adminPassword = "secure admin password 123";
    await repository.createFirstAdmin({
      name: "System Admin",
      email: "admin@example.com",
      passwordHash: await hashPassword(adminPassword),
    });
    const adminLogin = await request(app)
      .post("/api/auth/login")
      .set("Origin", WEB_ORIGIN)
      .send({ email: "admin@example.com", password: adminPassword });
    const adminCookie = sessionCookie(adminLogin);

    const organizerLogin = await request(app)
      .post("/api/auth/login")
      .set("Origin", WEB_ORIGIN)
      .send({ email: organizerInput.email, password: organizerInput.password });
    assert.equal((await request(app).get("/api/admin/organizations").set("Origin", WEB_ORIGIN).set("Cookie", sessionCookie(organizerLogin))).status, 403);
    assert.equal((await request(app)
      .patch(`/api/admin/organizations/${organizationId}/verification`)
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", sessionCookie(organizerLogin))
      .send({ verified: true })).status, 403);

    const deniedWithoutSession = await request(app).get("/api/admin/organizations").set("Origin", WEB_ORIGIN);
    assert.equal(deniedWithoutSession.status, 401);

    const listed = await request(app).get("/api/admin/organizations").set("Origin", WEB_ORIGIN).set("Cookie", adminCookie);
    assert.equal(listed.status, 200);
    assert.equal(listed.body.organizations.length, 1);
    assert.equal(listed.body.organizations[0].verified, false);
    assert.equal(listed.body.organizations[0].memberCount, 1);

    const invalid = await request(app)
      .patch(`/api/admin/organizations/${organizationId}/verification`)
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", adminCookie)
      .send({ verified: "yes" });
    assert.equal(invalid.status, 400);

    const verified = await request(app)
      .patch(`/api/admin/organizations/${organizationId}/verification`)
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", adminCookie)
      .send({ verified: true });
    assert.equal(verified.status, 200);
    assert.equal(verified.body.organization.verified, true);
    assert.ok(verified.body.organization.verifiedAt);

    const unverified = await request(app)
      .patch(`/api/admin/organizations/${organizationId}/verification`)
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", adminCookie)
      .send({ verified: false });
    assert.equal(unverified.status, 200);
    assert.equal(unverified.body.organization.verified, false);

    const auditActions = (await pool.query(
      "SELECT action, details FROM audit_logs WHERE entity_id = $1 ORDER BY created_at ASC",
      [organizationId],
    )).rows;
    assert.equal(auditActions.length, 2);
    assert.equal(auditActions[0].action, "ORGANIZATION_VERIFICATION_UPDATED");
    assert.equal(auditActions[0].details.verified, true);
    assert.equal(auditActions[1].details.verified, false);

    const missing = await request(app)
      .patch(`/api/admin/organizations/${"8".repeat(8)}-${"8".repeat(4)}-${"8".repeat(4)}-${"8".repeat(4)}-${"8".repeat(12)}/verification`)
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", adminCookie)
      .send({ verified: true });
    assert.equal(missing.status, 404);
  } finally {
    await pool.end();
  }
});
