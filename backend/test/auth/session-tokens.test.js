import assert from "node:assert/strict";
import test from "node:test";

import { createSessionToken, hashSessionToken } from "../../src/auth/sessionTokens.js";

test("opaque session token is 32 random bytes and stores only its SHA-256 digest", () => {
  const { token, tokenHash } = createSessionToken();

  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.match(tokenHash, /^[0-9a-f]{64}$/);
  assert.equal(hashSessionToken(token), tokenHash);
  assert.notEqual(token, tokenHash);
});

test("session hash rejects malformed token input", () => {
  assert.throws(() => hashSessionToken("bad token"), TypeError);
});
