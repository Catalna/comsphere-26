import { randomUUID } from "node:crypto";
import { transitionStatus } from "@dana-terang/domain";

const CAMPAIGN_COLUMNS = `id, organization_id, funder_id, title, description,
  total_budget, currency, funding_mode, status, start_date, end_date, created_at, updated_at`;
const MILESTONE_COLUMNS = `id, campaign_id, title, description, budget_amount,
  currency, order_index, status, start_date, due_date, created_at, updated_at`;

function repositoryError(code, message = code) {
  return Object.assign(new Error(message), { code });
}

function toMinorUnits(value) {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value)) {
    throw repositoryError("INVALID_AMOUNT");
  }
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
}

function moneyString(value) {
  const [whole, fraction = ""] = String(value).split(".");
  return `${whole}.${fraction.padEnd(2, "0").slice(0, 2)}`;
}

function dateString(value) {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

function campaignFromRow(row) {
  return {
    id: row.id,
    organizationId: row.organization_id,
    funderId: row.funder_id,
    title: row.title,
    description: row.description,
    totalBudget: moneyString(row.total_budget),
    currency: row.currency,
    fundingMode: row.funding_mode,
    status: row.status,
    startDate: dateString(row.start_date),
    endDate: dateString(row.end_date),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function milestoneFromRow(row) {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    title: row.title,
    description: row.description,
    budgetAmount: moneyString(row.budget_amount),
    currency: row.currency,
    orderIndex: row.order_index,
    status: row.status,
    startDate: dateString(row.start_date),
    dueDate: dateString(row.due_date),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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
    try { await client.query("ROLLBACK"); } catch { /* Preserve the original failure. */ }
    throw error;
  } finally {
    client.release();
  }
}

async function audit(client, { actorUserId, action, entityType, entityId, details, now }) {
  await client.query(
    `INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, details, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [randomUUID(), actorUserId, action, entityType, entityId, details, now],
  );
}

function requireOrganizer(actor) {
  if (actor?.role !== "ORGANIZER" || !actor.organizationId) throw repositoryError("FORBIDDEN");
}

function requireCampaignReader(actor) {
  if (!["ADMIN", "ORGANIZER", "FUNDER"].includes(actor?.role)) throw repositoryError("FORBIDDEN");
  if (actor.role === "ORGANIZER" && !actor.organizationId) throw repositoryError("FORBIDDEN");
}

export function createCampaignRepository(pool) {
  if (!pool || typeof pool.connect !== "function" || typeof pool.query !== "function") {
    throw new TypeError("A PostgreSQL-compatible pool is required");
  }

  return Object.freeze({
    async listCampaignPublications() {
      const result = await pool.query(
        `SELECT id, title, status, total_budget, currency, publicly_published_at
         FROM campaigns ORDER BY title ASC, id ASC`,
      );
      return result.rows.map((row) => ({
        campaignId: row.id,
        title: row.title,
        status: row.status,
        totalBudget: moneyString(row.total_budget),
        currency: row.currency,
        published: row.publicly_published_at != null,
        publishedAt: row.publicly_published_at,
      }));
    },

    async setCampaignPublication({ actor, campaignId, published, now = new Date() }) {
      if (actor?.role !== "ADMIN") throw repositoryError("FORBIDDEN");
      if (typeof campaignId !== "string" || typeof published !== "boolean") throw repositoryError("INVALID_PUBLICATION");
      return inTransaction(pool, async (client) => {
        const result = await client.query(
          `UPDATE campaigns
           SET publicly_published_at = $2, published_by = $3, updated_at = $4
           WHERE id = $1
           RETURNING id, title, status, total_budget, currency, publicly_published_at`,
          [campaignId, published ? now : null, published ? actor.id : null, now],
        );
        if (result.rowCount === 0) throw repositoryError("CAMPAIGN_NOT_FOUND");
        const row = result.rows[0];
        await audit(client, {
          actorUserId: actor.id,
          action: published ? "CAMPAIGN_PUBLISHED_FOR_PUBLIC_AUDIT" : "CAMPAIGN_UNPUBLISHED_FROM_PUBLIC_AUDIT",
          entityType: "CAMPAIGN",
          entityId: row.id,
          details: { published },
          now,
        });
        return {
          campaignId: row.id,
          title: row.title,
          status: row.status,
          currency: row.currency,
          totalBudget: moneyString(row.total_budget),
          published: row.publicly_published_at != null,
          publishedAt: row.publicly_published_at,
        };
      });
    },

    async publicCampaignProjection(campaignId) {
      const campaignResult = await pool.query(
        `SELECT id, title, status, total_budget, currency
         FROM campaigns WHERE id = $1 AND publicly_published_at IS NOT NULL LIMIT 1`,
        [campaignId],
      );
      if (campaignResult.rowCount === 0) return null;
      const campaign = campaignFromRow(campaignResult.rows[0]);

      const milestoneResult = await pool.query(
        `SELECT ${MILESTONE_COLUMNS} FROM milestones WHERE campaign_id = $1 ORDER BY order_index ASC, id ASC`,
        [campaignId],
      );
      const milestones = milestoneResult.rows.map(milestoneFromRow);
      const milestoneIds = milestones.map((milestone) => milestone.id);

      const verificationCounts = new Map();
      let verifiedEvidenceCount = 0;
      let evidenceTotal = 0;
      for (const milestoneId of milestoneIds) {
        const counts = { total: 0, verified: 0, needsRevision: 0, rejected: 0, pending: 0 };
        verificationCounts.set(milestoneId, counts);
        const rows = await pool.query(
          `SELECT v.status AS verification_status, COUNT(*)::int AS total
           FROM evidence e LEFT JOIN verifications v ON v.evidence_id = e.id
           WHERE e.milestone_id = $1
           GROUP BY v.status`,
          [milestoneId],
        );
        for (const row of rows.rows) {
          const total = Number(row.total);
          counts.total += total;
          evidenceTotal += total;
          if (row.verification_status === "VERIFIED") {
            counts.verified += total;
            verifiedEvidenceCount += total;
          } else if (row.verification_status === "NEEDS_REVISION") {
            counts.needsRevision += total;
          } else if (row.verification_status === "REJECTED") {
            counts.rejected += total;
          } else {
            counts.pending += total;
          }
        }
      }

      const proofResult = await pool.query(
        `SELECT proof_id, package_hash, status, transaction_hash, block_number, contract_address, anchored_at
         FROM proofs WHERE campaign_id = $1 ORDER BY created_at DESC, id DESC`,
        [campaignId],
      );

      return {
        campaignId: campaign.id,
        title: campaign.title,
        status: campaign.status,
        totalBudget: campaign.totalBudget,
        currency: campaign.currency,
        verifiedEvidenceCount,
        evidenceTotal,
        milestones: milestones.map((milestone) => ({
          milestoneId: milestone.id,
          title: milestone.title,
          status: milestone.status,
          budgetAmount: milestone.budgetAmount,
          verification: verificationCounts.get(milestone.id) ?? { total: 0, verified: 0, needsRevision: 0, rejected: 0, pending: 0 },
        })),
        proofs: proofResult.rows.map((row) => ({
          proofId: row.proof_id,
          status: row.status,
          packageHash: row.package_hash,
          transactionHash: row.transaction_hash,
          blockNumber: row.block_number === null || row.block_number === undefined ? null : Number(row.block_number),
          contractAddress: row.contract_address,
          anchoredAt: row.anchored_at,
        })),
      };
    },

    async listPublishedCampaigns() {
      const result = await pool.query(
        `SELECT id FROM campaigns WHERE publicly_published_at IS NOT NULL
         ORDER BY publicly_published_at DESC, id ASC`,
      );
      const campaigns = [];
      for (const row of result.rows) {
        const campaign = await this.publicCampaignProjection(row.id);
        if (campaign) campaigns.push(campaign);
      }
      return campaigns;
    },

    async listEligibleFunders() {
      const result = await pool.query(
        `SELECT u.id, u.name, u.role, u.status, u.organization_id,
                o.name AS organization_name, o.type AS organization_type, o.verified AS organization_verified
         FROM users u LEFT JOIN organizations o ON o.id = u.organization_id
         WHERE u.status = 'ACTIVE' ORDER BY u.name ASC, u.id ASC`,
      );
      return result.rows
        .filter((row) => row.role === "FUNDER")
        .map((row) => ({
          id: row.id,
          name: row.name,
          organizationId: row.organization_id,
          organization: row.organization_id == null ? null : {
            id: row.organization_id,
            name: row.organization_name,
            type: row.organization_type,
            verified: row.organization_verified,
          },
        }));
    },

    async createCampaign({ actor, funderId, title, description = "", totalBudget, currency, fundingMode = "EXTERNAL_TRACKING", startDate = null, endDate = null, now = new Date() }) {
      requireOrganizer(actor);
      if (toMinorUnits(totalBudget) <= 0n) throw repositoryError("INVALID_AMOUNT");
      if (fundingMode !== "EXTERNAL_TRACKING") throw repositoryError("INVALID_FUNDING_MODE");
      const normalizedCurrency = typeof currency === "string" ? currency.toUpperCase() : "";
      if (!/^[A-Z]{3}$/.test(normalizedCurrency)) throw repositoryError("INVALID_CURRENCY");

      return inTransaction(pool, async (client) => {
        const funder = await client.query("SELECT id, role, status FROM users WHERE id = $1 LIMIT 1", [funderId]);
        if (funder.rowCount === 0 || funder.rows[0].role !== "FUNDER" || funder.rows[0].status !== "ACTIVE") {
          throw repositoryError("FUNDER_NOT_AVAILABLE");
        }

        const result = await client.query(
          `INSERT INTO campaigns (${CAMPAIGN_COLUMNS})
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'DRAFT', $9, $10, $11, $11)
           RETURNING ${CAMPAIGN_COLUMNS}`,
          [randomUUID(), actor.organizationId, funderId, title.trim(), description.trim(), totalBudget, normalizedCurrency, fundingMode, startDate, endDate, now],
        );
        const campaign = campaignFromRow(result.rows[0]);
        await audit(client, {
          actorUserId: actor.id, action: "CAMPAIGN_CREATED", entityType: "CAMPAIGN",
          entityId: campaign.id, details: { funderId, title: campaign.title }, now,
        });
        return campaign;
      });
    },

    async listCampaignsForUser(actor) {
      requireCampaignReader(actor);
      let result;
      if (actor.role === "ADMIN") {
        result = await pool.query(`SELECT ${CAMPAIGN_COLUMNS} FROM campaigns ORDER BY created_at DESC, id ASC`);
      } else if (actor.role === "ORGANIZER") {
        result = await pool.query(
          `SELECT ${CAMPAIGN_COLUMNS} FROM campaigns WHERE organization_id = $1 ORDER BY created_at DESC, id ASC`,
          [actor.organizationId],
        );
      } else {
        result = await pool.query(
          `SELECT ${CAMPAIGN_COLUMNS} FROM campaigns WHERE funder_id = $1 ORDER BY created_at DESC, id ASC`,
          [actor.id],
        );
      }
      return result.rows.map(campaignFromRow);
    },

    async getCampaignForUser(actor, campaignId) {
      requireCampaignReader(actor);
      let predicate = "id = $1";
      const values = [campaignId];
      if (actor.role === "ORGANIZER") {
        predicate += " AND organization_id = $2";
        values.push(actor.organizationId);
      } else if (actor.role === "FUNDER") {
        predicate += " AND funder_id = $2";
        values.push(actor.id);
      }
      const result = await pool.query(`SELECT ${CAMPAIGN_COLUMNS} FROM campaigns WHERE ${predicate} LIMIT 1`, values);
      return result.rowCount === 0 ? null : campaignFromRow(result.rows[0]);
    },

    async updateCampaignDraft({ actor, campaignId, patch, now = new Date() }) {
      if (actor?.role !== "ADMIN") requireOrganizer(actor);
      return inTransaction(pool, async (client) => {
        const predicate = actor.role === "ORGANIZER" ? "id = $1 AND organization_id = $2" : "id = $1";
        const values = actor.role === "ORGANIZER" ? [campaignId, actor.organizationId] : [campaignId];
        const currentResult = await client.query(`SELECT ${CAMPAIGN_COLUMNS} FROM campaigns WHERE ${predicate} LIMIT 1`, values);
        if (currentResult.rowCount === 0) throw repositoryError("CAMPAIGN_NOT_FOUND");
        const current = campaignFromRow(currentResult.rows[0]);
        if (current.status !== "DRAFT") throw repositoryError("CAMPAIGN_NOT_EDITABLE");

        const next = {
          title: patch.title ?? current.title,
          description: patch.description ?? current.description,
          totalBudget: patch.totalBudget ?? current.totalBudget,
          currency: patch.currency?.toUpperCase() ?? current.currency,
          startDate: patch.startDate === undefined ? current.startDate : patch.startDate,
          endDate: patch.endDate === undefined ? current.endDate : patch.endDate,
        };
        const nextTotal = toMinorUnits(next.totalBudget);
        if (nextTotal <= 0n) throw repositoryError("INVALID_AMOUNT");
        if (!/^[A-Z]{3}$/.test(next.currency)) throw repositoryError("INVALID_CURRENCY");
        if (next.startDate && next.endDate && next.endDate < next.startDate) throw repositoryError("INVALID_DATE_RANGE");
        const milestones = await client.query("SELECT budget_amount, currency FROM milestones WHERE campaign_id = $1", [campaignId]);
        const allocated = milestones.rows.reduce((sum, row) => sum + toMinorUnits(moneyString(row.budget_amount)), 0n);
        if (milestones.rows.some((row) => row.currency !== next.currency) || allocated > nextTotal) {
          throw repositoryError("BUDGET_CONSTRAINT");
        }

        const updated = await client.query(
          `UPDATE campaigns SET title = $2, description = $3, total_budget = $4, currency = $5,
             start_date = $6, end_date = $7, updated_at = $8 WHERE id = $1 RETURNING ${CAMPAIGN_COLUMNS}`,
          [campaignId, next.title.trim(), next.description.trim(), next.totalBudget, next.currency, next.startDate, next.endDate, now],
        );
        const campaign = campaignFromRow(updated.rows[0]);
        await audit(client, {
          actorUserId: actor.id, action: "CAMPAIGN_UPDATED", entityType: "CAMPAIGN",
          entityId: campaign.id, details: { changedFields: Object.keys(patch) }, now,
        });
        return campaign;
      });
    },

    async activateCampaign({ actor, campaignId, now = new Date() }) {
      if (!["ADMIN", "FUNDER"].includes(actor?.role)) throw repositoryError("FORBIDDEN");
      return inTransaction(pool, async (client) => {
        const result = await client.query(`SELECT ${CAMPAIGN_COLUMNS} FROM campaigns WHERE id = $1 LIMIT 1`, [campaignId]);
        if (result.rowCount === 0) throw repositoryError("CAMPAIGN_NOT_FOUND");
        const current = campaignFromRow(result.rows[0]);
        if (actor.role === "FUNDER" && current.funderId !== actor.id) throw repositoryError("CAMPAIGN_NOT_FOUND");
        if (current.status !== "DRAFT") throw repositoryError("CAMPAIGN_NOT_ACTIVATABLE");
        const milestoneCount = await client.query("SELECT id FROM milestones WHERE campaign_id = $1", [campaignId]);
        if (milestoneCount.rowCount === 0) throw repositoryError("MILESTONES_REQUIRED");
        const nextStatus = transitionStatus("campaign", current.status, "ACTIVE");
        const updated = await client.query(
          "UPDATE campaigns SET status = $2, updated_at = $3 WHERE id = $1 RETURNING *",
          [campaignId, nextStatus, now],
        );
        const campaign = campaignFromRow(updated.rows[0]);
        await audit(client, {
          actorUserId: actor.id, action: "CAMPAIGN_ACTIVATED", entityType: "CAMPAIGN",
          entityId: campaign.id, details: { fromStatus: current.status, toStatus: nextStatus }, now,
        });
        return campaign;
      });
    },

    async createMilestone({ actor, campaignId, title, description = "", budgetAmount, currency, orderIndex, startDate = null, dueDate = null, now = new Date() }) {
      requireOrganizer(actor);
      if (!Number.isSafeInteger(orderIndex) || orderIndex < 0) throw repositoryError("INVALID_ORDER_INDEX");
      const amount = toMinorUnits(budgetAmount);
      if (amount <= 0n) throw repositoryError("INVALID_AMOUNT");
      const normalizedCurrency = typeof currency === "string" ? currency.toUpperCase() : "";
      if (!/^[A-Z]{3}$/.test(normalizedCurrency)) throw repositoryError("INVALID_CURRENCY");

      return inTransaction(pool, async (client) => {
        const campaignResult = await client.query(
          `SELECT ${CAMPAIGN_COLUMNS} FROM campaigns
           WHERE id = $1 AND organization_id = $2 LIMIT 1`,
          [campaignId, actor.organizationId],
        );
        if (campaignResult.rowCount === 0) throw repositoryError("CAMPAIGN_NOT_FOUND");
        const campaign = campaignFromRow(campaignResult.rows[0]);
        if (campaign.status !== "DRAFT") throw repositoryError("CAMPAIGN_NOT_EDITABLE");
        if (campaign.currency !== normalizedCurrency) throw repositoryError("CURRENCY_MISMATCH");

        const allocatedRows = await client.query("SELECT budget_amount FROM milestones WHERE campaign_id = $1", [campaignId]);
        const allocated = allocatedRows.rows.reduce((sum, row) => sum + toMinorUnits(moneyString(row.budget_amount)), 0n);
        if (allocated + amount > toMinorUnits(campaign.totalBudget)) throw repositoryError("BUDGET_CONSTRAINT");

        const result = await client.query(
          `INSERT INTO milestones (${MILESTONE_COLUMNS})
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'PLANNED', $8, $9, $10, $10)
           RETURNING ${MILESTONE_COLUMNS}`,
          [randomUUID(), campaignId, title.trim(), description.trim(), budgetAmount, normalizedCurrency, orderIndex, startDate, dueDate, now],
        );
        const milestone = milestoneFromRow(result.rows[0]);
        await audit(client, {
          actorUserId: actor.id, action: "MILESTONE_CREATED", entityType: "MILESTONE",
          entityId: milestone.id, details: { campaignId, orderIndex }, now,
        });
        return milestone;
      });
    },

    async listMilestonesForCampaign(actor, campaignId) {
      requireCampaignReader(actor);
      let predicate = "id = $1";
      const values = [campaignId];
      if (actor.role === "ORGANIZER") {
        predicate += " AND organization_id = $2";
        values.push(actor.organizationId);
      } else if (actor.role === "FUNDER") {
        predicate += " AND funder_id = $2";
        values.push(actor.id);
      }
      const campaign = await pool.query(`SELECT id FROM campaigns WHERE ${predicate} LIMIT 1`, values);
      if (campaign.rowCount === 0) return null;
      const result = await pool.query(
        `SELECT ${MILESTONE_COLUMNS} FROM milestones WHERE campaign_id = $1 ORDER BY order_index ASC, id ASC`,
        [campaignId],
      );
      return result.rows.map(milestoneFromRow);
    },

    async updateMilestoneStatus({ actor, milestoneId, status, now = new Date() }) {
      requireOrganizer(actor);
      return inTransaction(pool, async (client) => {
        const result = await client.query(
          `SELECT m.id, m.campaign_id, m.status, c.status AS campaign_status
           FROM milestones m JOIN campaigns c ON c.id = m.campaign_id
           WHERE m.id = $1 AND c.organization_id = $2 LIMIT 1`,
          [milestoneId, actor.organizationId],
        );
        if (result.rowCount === 0) throw repositoryError("MILESTONE_NOT_FOUND");
        const current = result.rows[0];
        if (current.campaign_status !== "ACTIVE") throw repositoryError("CAMPAIGN_NOT_ACTIVE");
        const nextStatus = transitionStatus("milestone", current.status, status);
        const updated = await client.query(
          `UPDATE milestones SET status = $2, updated_at = $3 WHERE id = $1
           RETURNING ${MILESTONE_COLUMNS}`,
          [milestoneId, nextStatus, now],
        );
        const milestone = milestoneFromRow(updated.rows[0]);
        await audit(client, {
          actorUserId: actor.id, action: "MILESTONE_STATUS_CHANGED", entityType: "MILESTONE",
          entityId: milestone.id, details: { fromStatus: current.status, toStatus: nextStatus }, now,
        });
        return milestone;
      });
    },
  });
}
