import assert from "node:assert/strict";
import test from "node:test";

import { hashPassword, verifyPassword } from "../../src/auth/passwords.js";

test("scrypt password hashes verify without storing plaintext", async () => {
  const password = "correct horse battery staple";
  const encoded = await hashPassword(password);

  assert.match(encoded, /^scrypt\$16384\$8\$1\$/);
  assert.notEqual(encoded, password);
  assert.equal(await verifyPassword(password, encoded), true);
  assert.equal(await verifyPassword("different password", encoded), false);
});

test("malformed password hashes fail closed", async () => {
  assert.equal(await verifyPassword("correct horse battery staple", "not-a-scrypt-hash"), false);
});

test("password length limits are enforced before hashing", async () => {
  await assert.rejects(hashPassword("short"), /12/);
  await assert.rejects(hashPassword("x".repeat(129)), /128/);
});
