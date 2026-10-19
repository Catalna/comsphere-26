import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);
const N = 16384;
const R = 8;
const P = 1;
const SALT_BYTES = 16;
const KEY_BYTES = 64;
const MAX_MEMORY = 64 * 1024 * 1024;

function validatePassword(password) {
  if (typeof password !== "string" || password.length < 12 || password.length > 128) {
    throw new TypeError("Password must be between 12 and 128 characters");
  }
}

function parseHash(encoded) {
  if (typeof encoded !== "string") return null;
  const parts = encoded.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt" || parts[1] !== String(N) || parts[2] !== String(R) || parts[3] !== String(P)) {
    return null;
  }
  if (!/^[A-Za-z0-9_-]{22}$/.test(parts[4]) || !/^[A-Za-z0-9_-]{86}$/.test(parts[5])) return null;
  const salt = Buffer.from(parts[4], "base64url");
  const expected = Buffer.from(parts[5], "base64url");
  if (salt.length !== SALT_BYTES || expected.length !== KEY_BYTES) return null;
  return { salt, expected };
}

export async function hashPassword(password) {
  validatePassword(password);
  const salt = randomBytes(SALT_BYTES);
  const key = await scryptAsync(password, salt, KEY_BYTES, { N, r: R, p: P, maxmem: MAX_MEMORY });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64url")}$${Buffer.from(key).toString("base64url")}`;
}

export async function verifyPassword(password, encodedHash) {
  if (typeof password !== "string") return false;
  const parsed = parseHash(encodedHash);
  if (!parsed) return false;
  const actual = await scryptAsync(password, parsed.salt, KEY_BYTES, { N, r: R, p: P, maxmem: MAX_MEMORY });
  return timingSafeEqual(Buffer.from(actual), parsed.expected);
}
