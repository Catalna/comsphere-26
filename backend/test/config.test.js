import assert from "node:assert/strict";
import test from "node:test";

import { readApiConfig } from "../src/config.js";

test("development without a database remains health-only", () => {
  assert.deepEqual(readApiConfig({ NODE_ENV: "development" }), {
    nodeEnv: "development",
    port: 4000,
    host: "127.0.0.1",
    databaseUrl: null,
    webOrigin: null,
    autoMigrate: false,
  });
});

test("database-backed development requires an exact web origin and allows explicit migrations", () => {
  const config = readApiConfig({
    NODE_ENV: "development",
    PORT: "4100",
    DATABASE_URL: "postgres://user:password@localhost:5432/dana_terang",
    WEB_ORIGIN: "http://localhost:3000",
    AUTO_MIGRATE: "true",
  });
  assert.equal(config.port, 4100);
  assert.equal(config.autoMigrate, true);
  assert.equal(config.webOrigin, "http://localhost:3000");
});

test("production requires the database and origin and never auto-migrates", () => {
  assert.throws(() => readApiConfig({ NODE_ENV: "production" }), { code: "INVALID_API_CONFIGURATION" });
  assert.throws(() => readApiConfig({ NODE_ENV: "production", DATABASE_URL: "postgres://db" }), { code: "INVALID_API_CONFIGURATION" });
  assert.throws(() => readApiConfig({
    NODE_ENV: "production",
    DATABASE_URL: "postgres://db",
    WEB_ORIGIN: "https://dana.example",
    AUTO_MIGRATE: "true",
  }), { code: "INVALID_API_CONFIGURATION" });
});

test("invalid ports, origins, and migration settings fail closed", () => {
  assert.throws(() => readApiConfig({ PORT: "0" }), { code: "INVALID_API_CONFIGURATION" });
  assert.throws(() => readApiConfig({ WEB_ORIGIN: "https://example.com/path" }), { code: "INVALID_API_CONFIGURATION" });
  assert.throws(() => readApiConfig({ WEB_ORIGIN: "https://*.example.com" }), { code: "INVALID_API_CONFIGURATION" });
  assert.throws(() => readApiConfig({ WEB_ORIGIN: 3000 }), { code: "INVALID_API_CONFIGURATION" });
  assert.throws(() => readApiConfig({ AUTO_MIGRATE: "maybe" }), { code: "INVALID_API_CONFIGURATION" });
  assert.throws(() => readApiConfig({ NODE_ENV: "test", AUTO_MIGRATE: "true", DATABASE_URL: "postgres://db", WEB_ORIGIN: "http://localhost:3000" }), { code: "INVALID_API_CONFIGURATION" });
});
