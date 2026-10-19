import { randomUUID } from "node:crypto";

function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

const ASSIGNABLE_ROLES = new Set(["ORGANIZER", "FUNDER", "VERIFIER", "BENEFICIARY"]);

function publicUser(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email_normalized,
    role: row.role,
    organizationId: row.organization_id,
    status: row.status,
    organization: row.organization_id == null || row.organization_name == null ? null : {
      id: row.organization_id,
      name: row.organization_name,
      type: row.organization_type,
      verified: row.organization_verified,
    },
  };
}

async function inTransaction(pool, callback) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the original repository error.
    }
    throw error;
  } finally {
    client.release();
  }
}

export function createAuthRepository(pool) {
  if (!pool || typeof pool.connect !== "function" || typeof pool.query !== "function") {
    throw new TypeError("A PostgreSQL-compatible pool is required");
  }

  return Object.freeze({
    async listUsersForAdmin() {
      const result = await pool.query(
        `SELECT u.id, u.name, u.email_normalized, u.role, u.organization_id, u.status,
                o.name AS organization_name, o.type AS organization_type, o.verified AS organization_verified
         FROM users u LEFT JOIN organizations o ON o.id = u.organization_id
         ORDER BY u.email_normalized ASC`,
      );
      return result.rows.map(publicUser);
    },

    async listOrganizationsForAdmin() {
      const result = await pool.query(
        `SELECT o.id, o.name, o.type, o.verified, o.verified_at, o.verified_by,
                SUM(CASE WHEN u.id IS NULL THEN 0 ELSE 1 END) AS member_count
         FROM organizations o LEFT JOIN users u ON u.organization_id = o.id
         GROUP BY o.id, o.name, o.type, o.verified, o.verified_at, o.verified_by
         ORDER BY o.name ASC`,
      );
      return result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        type: row.type,
        verified: row.verified,
        verifiedAt: row.verified_at,
        verifiedBy: row.verified_by,
        memberCount: Number(row.member_count),
      }));
    },

    async setOrganizationVerification({ actorUserId, organizationId, verified, now = new Date() }) {
      return inTransaction(pool, async (client) => {
        const actor = await client.query(
          "SELECT id FROM users WHERE id = $1 AND role = 'ADMIN' AND status = 'ACTIVE' LIMIT 1",
          [actorUserId],
        );
        if (actor.rowCount === 0) throw Object.assign(new Error("Admin authorization required"), { code: "FORBIDDEN" });
        const updated = await client.query(
          `UPDATE organizations SET verified = $2, verified_at = $3, verified_by = $4, updated_at = $5
           WHERE id = $1
           RETURNING id, name, type, verified, verified_at, verified_by`,
          [organizationId, verified, verified ? now : null, verified ? actorUserId : null, now],
        );
        if (updated.rowCount === 0) throw Object.assign(new Error("Organization not found"), { code: "ORGANIZATION_NOT_FOUND" });
        const organization = updated.rows[0];
        await client.query(
          `INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, details, created_at)
           VALUES ($1, $2, 'ORGANIZATION_VERIFICATION_UPDATED', 'organization', $3, $4, $5)`,
          [randomUUID(), actorUserId, organizationId, JSON.stringify({ verified, organizationName: organization.name }), now],
        );
        return {
          id: organization.id,
          name: organization.name,
          type: organization.type,
          verified: organization.verified,
          verifiedAt: organization.verified_at,
        };
      });
    },

    async registerOrganizer({
      name,
      email,
      passwordHash,
      organizationName,
      organizationType,
      acceptedTermsVersion,
      sessionTokenHash,
      sessionExpiresAt,
      now = new Date(),
    }) {
      const userId = randomUUID();
      const organizationId = randomUUID();
      const sessionId = randomUUID();
      const normalizedEmail = normalizeEmail(email);

      return inTransaction(pool, async (client) => {
        const organizationResult = await client.query(
          `INSERT INTO organizations (id, name, type, verified, created_at, updated_at)
           VALUES ($1, $2, $3, FALSE, $4, $4)
           RETURNING id, name, type, verified`,
          [organizationId, organizationName.trim(), organizationType.toUpperCase(), now],
        );

        const userResult = await client.query(
          `INSERT INTO users (id, organization_id, name, email_normalized, password_hash, role, status, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, 'ORGANIZER', 'ACTIVE', $6, $6)
           RETURNING id, name, email_normalized, role, organization_id, status`,
          [userId, organizationId, name.trim(), normalizedEmail, passwordHash, now],
        );

        await client.query(
          `INSERT INTO user_sessions (id, user_id, token_hash, expires_at, revoked_at, created_at)
           VALUES ($1, $2, $3, $4, NULL, $5)`,
          [sessionId, userId, sessionTokenHash, sessionExpiresAt, now],
        );

        // The registration service always provides the validated TERMS_VERSION;
        // direct repository callers (tests, seeding) may omit it.
        if (typeof acceptedTermsVersion === "string" && acceptedTermsVersion.length > 0) {
          await client.query(
            `INSERT INTO terms_acceptances (id, user_id, terms_version, accepted_at)
             VALUES ($1, $2, $3, $4)`,
            [randomUUID(), userId, acceptedTermsVersion, now],
          );
        }

        const organization = organizationResult.rows[0];
        const user = userResult.rows[0];
        return {
          user: {
            ...publicUser({ ...user, organization_name: organization.name, organization_type: organization.type, organization_verified: organization.verified }),
          },
          organization,
        };
      });
    },

    async findUserByEmail(email) {
      const result = await pool.query(
        `SELECT u.id, u.name, u.email_normalized, u.password_hash, u.role, u.organization_id, u.status,
                o.name AS organization_name, o.type AS organization_type, o.verified AS organization_verified
         FROM users u LEFT JOIN organizations o ON o.id = u.organization_id
         WHERE u.email_normalized = $1 LIMIT 1`,
        [normalizeEmail(email)],
      );
      if (result.rowCount === 0) return null;
      return { ...publicUser(result.rows[0]), passwordHash: result.rows[0].password_hash };
    },

    async createFirstAdmin({ name, email, passwordHash, now = new Date() }) {
      return inTransaction(pool, async (client) => {
        const existing = await client.query("SELECT id FROM users WHERE role = 'ADMIN' LIMIT 1");
        if (existing.rowCount > 0) {
          throw Object.assign(new Error("Admin bootstrap already completed"), { code: "ADMIN_ALREADY_EXISTS" });
        }

        const result = await client.query(
          `INSERT INTO users (id, organization_id, name, email_normalized, password_hash, role, status, created_at, updated_at)
           VALUES ($1, NULL, $2, $3, $4, 'ADMIN', 'ACTIVE', $5, $5)
           RETURNING id, name, email_normalized, role, organization_id, status`,
          [randomUUID(), name.trim(), normalizeEmail(email), passwordHash, now],
        );
        return { user: publicUser(result.rows[0]) };
      });
    },

    async assignRoleAndAudit({ actorUserId, targetUserId, role, now = new Date() }) {
      if (!ASSIGNABLE_ROLES.has(role)) throw new TypeError("Role is not assignable through this operation");

      return inTransaction(pool, async (client) => {
        const actor = await client.query(
          "SELECT id FROM users WHERE id = $1 AND role = 'ADMIN' AND status = 'ACTIVE' LIMIT 1",
          [actorUserId],
        );
        if (actor.rowCount === 0) throw Object.assign(new Error("Admin authorization required"), { code: "FORBIDDEN" });

        const targetResult = await client.query(
          `SELECT u.id, u.name, u.email_normalized, u.role, u.organization_id, u.status,
                  o.name AS organization_name, o.type AS organization_type, o.verified AS organization_verified
           FROM users u LEFT JOIN organizations o ON o.id = u.organization_id
           WHERE u.id = $1 LIMIT 1`,
          [targetUserId],
        );
        if (targetResult.rowCount === 0) throw Object.assign(new Error("User not found"), { code: "USER_NOT_FOUND" });
        const current = targetResult.rows[0];
        if (current.role === "ADMIN") throw Object.assign(new Error("Bootstrap Admin role cannot be changed"), { code: "ADMIN_ROLE_PROTECTED" });
        if (current.organization_id == null) throw Object.assign(new Error("User organization is required for this role"), { code: "ORGANIZATION_REQUIRED" });
        if (current.role === role) return publicUser(current);

        const updatedResult = await client.query(
          `UPDATE users SET role = $2, updated_at = $3 WHERE id = $1
           RETURNING id, name, email_normalized, role, organization_id, status`,
          [targetUserId, role, now],
        );
        await client.query(
          "UPDATE user_sessions SET revoked_at = $2 WHERE user_id = $1 AND revoked_at IS NULL",
          [targetUserId, now],
        );
        await client.query(
          `INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, details, created_at)
           VALUES ($1, $2, 'USER_ROLE_CHANGED', 'USER', $3, $4, $5)`,
          [randomUUID(), actorUserId, targetUserId, { fromRole: current.role, toRole: role }, now],
        );

        const updated = updatedResult.rows[0];
        return publicUser({
          ...updated,
          organization_name: current.organization_name,
          organization_type: current.organization_type,
          organization_verified: current.organization_verified,
        });
      });
    },

    async findSessionUser(tokenHash, now = new Date()) {
      const result = await pool.query(
        `SELECT u.id, u.name, u.email_normalized, u.role, u.organization_id, u.status,
                o.name AS organization_name, o.type AS organization_type, o.verified AS organization_verified
         FROM user_sessions s
         JOIN users u ON u.id = s.user_id
         LEFT JOIN organizations o ON o.id = u.organization_id
         WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > $2 AND u.status = 'ACTIVE'
         LIMIT 1`,
        [tokenHash, now],
      );
      return result.rowCount === 0 ? null : publicUser(result.rows[0]);
    },

    async createSession({ userId, tokenHash, expiresAt, now = new Date() }) {
      const id = randomUUID();
      await pool.query(
        `INSERT INTO user_sessions (id, user_id, token_hash, expires_at, revoked_at, created_at)
         VALUES ($1, $2, $3, $4, NULL, $5)`,
        [id, userId, tokenHash, expiresAt, now],
      );
      return { id, userId, tokenHash, expiresAt, createdAt: now };
    },

    async revokeSession(tokenHash, revokedAt = new Date()) {
      const result = await pool.query(
        `UPDATE user_sessions SET revoked_at = $2
         WHERE token_hash = $1 AND revoked_at IS NULL`,
        [tokenHash, revokedAt],
      );
      return result.rowCount;
    },
  });
}
