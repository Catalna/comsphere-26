import "dotenv/config";

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { hashPassword } from "../src/auth/passwords.js";
import { createPool } from "../src/db/pool.js";
import { createAuthRepository } from "../src/repositories/authRepository.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function invalidConfiguration() {
  return Object.assign(new Error("Invalid bootstrap configuration"), { code: "INVALID_BOOTSTRAP_CONFIGURATION" });
}

function readBootstrapInput(env) {
  const { DATABASE_URL, BOOTSTRAP_ADMIN_NAME, BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_PASSWORD } = env;
  if ([DATABASE_URL, BOOTSTRAP_ADMIN_NAME, BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_PASSWORD].some((value) => typeof value !== "string" || value.length === 0)) {
    throw invalidConfiguration();
  }
  if (DATABASE_URL.trim().length === 0) throw invalidConfiguration();

  const name = BOOTSTRAP_ADMIN_NAME.trim();
  const email = BOOTSTRAP_ADMIN_EMAIL.trim().toLowerCase();
  if (name.length < 1 || name.length > 160 || email.length > 254 || !EMAIL_PATTERN.test(email)) {
    throw invalidConfiguration();
  }
  if (BOOTSTRAP_ADMIN_PASSWORD.length < 12 || BOOTSTRAP_ADMIN_PASSWORD.length > 128) {
    throw invalidConfiguration();
  }
  return { databaseUrl: DATABASE_URL.trim(), name, email, password: BOOTSTRAP_ADMIN_PASSWORD };
}

export async function provisionAdmin({ env = process.env, poolFactory = createPool } = {}) {
  const input = readBootstrapInput(env);
  const pool = poolFactory(input.databaseUrl);
  try {
    const passwordHash = await hashPassword(input.password);
    const repository = createAuthRepository(pool);
    return await repository.createFirstAdmin({ name: input.name, email: input.email, passwordHash });
  } finally {
    await pool.end();
  }
}

async function runCli() {
  try {
    await provisionAdmin();
    console.log("First Admin account provisioned.");
  } catch (error) {
    if (error?.code === "ADMIN_ALREADY_EXISTS") {
      console.error("Admin provisioning refused: an Admin account already exists.");
    } else {
      console.error("Admin provisioning failed. Check required environment variables and database availability.");
    }
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await runCli();
}
