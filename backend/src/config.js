const ENVIRONMENTS = new Set(["development", "test", "production"]);

function configurationError() {
  return Object.assign(new Error("Invalid API configuration"), { code: "INVALID_API_CONFIGURATION" });
}

function validateOrigin(value) {
  if (value === "" || value === undefined || value === null) return null;
  if (typeof value !== "string") throw configurationError();
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw configurationError();
  }
  if (!new Set(["http:", "https:"]).has(parsed.protocol) || parsed.hostname.includes("*") || parsed.origin !== value) {
    throw configurationError();
  }
  return value;
}

export function readApiConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV ?? "development";
  const port = Number(env.PORT ?? 4000);
  const host = env.HOST ?? "127.0.0.1";
  const databaseUrl = typeof env.DATABASE_URL === "string" && env.DATABASE_URL.trim().length > 0
    ? env.DATABASE_URL.trim()
    : null;
  const webOrigin = validateOrigin(env.WEB_ORIGIN ?? "");
  const autoMigrateValue = env.AUTO_MIGRATE ?? "false";

  if (!ENVIRONMENTS.has(nodeEnv) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw configurationError();
  }
  if (typeof host !== "string" || host.trim().length === 0) throw configurationError();
  if (autoMigrateValue !== "true" && autoMigrateValue !== "false") throw configurationError();

  const autoMigrate = autoMigrateValue === "true";
  if (nodeEnv === "production" && (!databaseUrl || !webOrigin)) throw configurationError();
  if (databaseUrl && !webOrigin) throw configurationError();
  if (autoMigrate && (nodeEnv !== "development" || !databaseUrl)) throw configurationError();

  return { nodeEnv, port, host, databaseUrl, webOrigin, autoMigrate };
}
