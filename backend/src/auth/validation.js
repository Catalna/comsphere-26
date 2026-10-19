const ORGANIZATION_TYPES = new Set(["NGO", "COMPANY", "GOVERNMENT", "COMMUNITY", "OTHER"]);
const ASSIGNABLE_ROLES = new Set(["ORGANIZER", "FUNDER", "VERIFIER", "BENEFICIARY"]);
// Bump this version whenever the published Terms & Conditions text changes;
// every acceptance is recorded with this version for audit purposes.
export const TERMS_VERSION = "2026-10-07-funder-terms-v1";
const CURRENCIES = new Set(Intl.supportedValuesOf("currency"));
const FUNDING_MODES = new Set(["EXTERNAL_TRACKING"]);
const CAMPAIGN_STATUSES = new Set(["DRAFT", "ACTIVE", "COMPLETED", "CANCELLED"]);
const MILESTONE_STATUSES = new Set(["PLANNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"]);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactlyKeys(value, expected) {
  return isPlainObject(value)
    && Object.keys(value).length === expected.length
    && expected.every((key) => Object.hasOwn(value, key));
}

function hasOnlyKeys(value, allowed) {
  return isPlainObject(value) && Object.keys(value).every((key) => allowed.includes(key));
}

function isIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isPositiveDecimal(value) {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value)) return false;
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0")) > 0n;
}

function parseCurrency(value) {
  if (typeof value !== "string") return null;
  const currency = value.toUpperCase();
  return CURRENCIES.has(currency) ? currency : null;
}

export function parseRegistration(value) {
  const keys = ["name", "email", "password", "organizationName", "organizationType", "acceptedTermsVersion"];
  if (!hasExactlyKeys(value, keys)) return null;
  if (typeof value.name !== "string" || typeof value.email !== "string" || typeof value.organizationName !== "string") return null;
  if (typeof value.password !== "string") return null;
  if (value.acceptedTermsVersion !== TERMS_VERSION) return null;

  const name = value.name.trim();
  const email = value.email.trim().toLowerCase();
  const organizationName = value.organizationName.trim();
  if (name.length < 1 || name.length > 160) return null;
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) return null;
  if (value.password.length < 12 || value.password.length > 128) return null;
  if (organizationName.length < 2 || organizationName.length > 180) return null;
  if (!ORGANIZATION_TYPES.has(value.organizationType)) return null;

  return { name, email, password: value.password, organizationName, organizationType: value.organizationType, acceptedTermsVersion: TERMS_VERSION };
}

export function parseOrganizationVerification(value) {
  if (!hasExactlyKeys(value, ["verified"]) || typeof value.verified !== "boolean") return null;
  return { verified: value.verified };
}

export function parseCampaignPublication(value) {
  if (!hasExactlyKeys(value, ["published"]) || typeof value.published !== "boolean") return null;
  return { published: value.published };
}

export function parseLogin(value) {
  if (!hasExactlyKeys(value, ["email", "password"])) return null;
  if (typeof value.email !== "string" || typeof value.password !== "string") return null;
  const email = value.email.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) return null;
  if (value.password.length < 12 || value.password.length > 128) return null;
  return { email, password: value.password };
}

export function parseRoleUpdate(value) {
  if (!hasExactlyKeys(value, ["role"]) || !ASSIGNABLE_ROLES.has(value.role)) return null;
  return { role: value.role };
}

export function parseCampaignCreate(value) {
  const allowed = ["funderId", "title", "description", "totalBudget", "currency", "fundingMode", "startDate", "endDate"];
  if (!hasOnlyKeys(value, allowed) || !["funderId", "title", "totalBudget", "currency"].every((key) => Object.hasOwn(value, key))) return null;
  if (!isUserId(value.funderId) || typeof value.title !== "string" || typeof value.description !== "undefined" && typeof value.description !== "string") return null;
  const title = value.title.trim();
  const description = (value.description ?? "").trim();
  const currency = parseCurrency(value.currency);
  const fundingMode = value.fundingMode ?? "EXTERNAL_TRACKING";
  if (title.length < 3 || title.length > 160 || description.length > 4000) return null;
  if (!isPositiveDecimal(value.totalBudget) || !currency || !FUNDING_MODES.has(fundingMode)) return null;
  if (value.startDate !== undefined && !isIsoDate(value.startDate)) return null;
  if (value.endDate !== undefined && !isIsoDate(value.endDate)) return null;
  if (value.startDate && value.endDate && value.endDate < value.startDate) return null;
  return { funderId: value.funderId, title, description, totalBudget: value.totalBudget, currency, fundingMode, startDate: value.startDate ?? null, endDate: value.endDate ?? null };
}

export function parseCampaignUpdate(value) {
  const allowed = ["title", "description", "totalBudget", "currency", "startDate", "endDate"];
  if (!hasOnlyKeys(value, allowed) || Object.keys(value).length === 0) return null;
  if (value.title !== undefined && (typeof value.title !== "string" || value.title.trim().length < 3 || value.title.trim().length > 160)) return null;
  if (value.description !== undefined && (typeof value.description !== "string" || value.description.trim().length > 4000)) return null;
  if (value.totalBudget !== undefined && !isPositiveDecimal(value.totalBudget)) return null;
  if (value.currency !== undefined && !parseCurrency(value.currency)) return null;
  if (value.startDate !== undefined && value.startDate !== null && !isIsoDate(value.startDate)) return null;
  if (value.endDate !== undefined && value.endDate !== null && !isIsoDate(value.endDate)) return null;
  if (value.startDate && value.endDate && value.endDate < value.startDate) return null;
  return {
    ...value,
    ...(value.title === undefined ? {} : { title: value.title.trim() }),
    ...(value.description === undefined ? {} : { description: value.description.trim() }),
    ...(value.currency === undefined ? {} : { currency: parseCurrency(value.currency) }),
  };
}

export function parseMilestoneCreate(value) {
  const allowed = ["title", "description", "budgetAmount", "currency", "orderIndex", "startDate", "dueDate"];
  if (!hasOnlyKeys(value, allowed) || !["title", "budgetAmount", "currency", "orderIndex"].every((key) => Object.hasOwn(value, key))) return null;
  if (typeof value.title !== "string" || (value.description !== undefined && typeof value.description !== "string")) return null;
  const title = value.title.trim();
  const description = (value.description ?? "").trim();
  const currency = parseCurrency(value.currency);
  if (title.length < 3 || title.length > 160 || description.length > 4000) return null;
  if (!isPositiveDecimal(value.budgetAmount) || !currency || !Number.isSafeInteger(value.orderIndex) || value.orderIndex < 0) return null;
  if (value.startDate !== undefined && value.startDate !== null && !isIsoDate(value.startDate)) return null;
  if (value.dueDate !== undefined && value.dueDate !== null && !isIsoDate(value.dueDate)) return null;
  if (value.startDate && value.dueDate && value.dueDate < value.startDate) return null;
  return { ...value, title, description, currency };
}

export function parseMilestoneStatus(value) {
  if (!hasExactlyKeys(value, ["status"]) || !MILESTONE_STATUSES.has(value.status)) return null;
  return { status: value.status };
}

export function isUserId(value) {
  return typeof value === "string" && UUID_PATTERN.test(value);
}
