import { createHash, randomBytes } from "node:crypto";

const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function createSessionToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashSessionToken(token) };
}

export function hashSessionToken(token) {
  if (typeof token !== "string" || !SESSION_TOKEN_PATTERN.test(token)) {
    throw new TypeError("Malformed session token");
  }
  const tokenBytes = Buffer.from(token, "base64url");
  if (tokenBytes.length !== 32 || tokenBytes.toString("base64url") !== token) {
    throw new TypeError("Malformed session token");
  }
  return createHash("sha256").update(token, "utf8").digest("hex");
}
