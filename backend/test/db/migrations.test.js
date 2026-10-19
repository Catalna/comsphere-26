import assert from "node:assert/strict";
import test from "node:test";
import { newDb } from "pg-mem";

import { rollbackLastMigration, runMigrations } from "../../src/db/migrate.js";

test("applies ordered migrations once and rolls back the latest migration", async () => {
  const memoryDb = newDb();
  memoryDb.public.registerFunction({
    name: "trim",
    args: ["text"],
    returns: "text",
    implementation: (value) => value.trim(),
  });
  memoryDb.public.registerFunction({
    name: "length",
    args: ["text"],
    returns: "integer",
    implementation: (value) => value.length,
  });
  const { Pool } = memoryDb.adapters.createPg();
  const pool = new Pool();

  try {
    assert.deepEqual(await runMigrations(pool), ["001_identity", "002_campaigns_milestones", "003_evidence", "004_ocr_processing", "005_peer_review", "006_proof_anchor", "007_funder_governance", "008_proof_schema_version", "009_campaign_publication", "010_ai_enrichment"]);
    assert.deepEqual(await runMigrations(pool), []);
    const applied = await pool.query("SELECT migration_id FROM schema_migrations ORDER BY migration_id");
    assert.deepEqual(applied.rows, [
      { migration_id: "001_identity" },
      { migration_id: "002_campaigns_milestones" },
      { migration_id: "003_evidence" },
      { migration_id: "004_ocr_processing" },
      { migration_id: "005_peer_review" },
      { migration_id: "006_proof_anchor" },
      { migration_id: "007_funder_governance" },
      { migration_id: "008_proof_schema_version" },
      { migration_id: "009_campaign_publication" },
      { migration_id: "010_ai_enrichment" },
    ]);
    const aiColumns = await pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'ocr_runs' AND column_name IN ('ai_model', 'ai_enrichment_status', 'ai_enrichment') ORDER BY column_name",
    );
    assert.deepEqual(aiColumns.rows.map((row) => row.column_name), ["ai_enrichment", "ai_enrichment_status", "ai_model"]);
    await pool.query("SELECT * FROM organizations LIMIT 0");
    await pool.query("SELECT * FROM users LIMIT 0");
    await pool.query("SELECT * FROM user_sessions LIMIT 0");
    await pool.query("SELECT * FROM audit_logs LIMIT 0");
    await pool.query("SELECT * FROM campaigns LIMIT 0");
    await pool.query("SELECT * FROM milestones LIMIT 0");
    await pool.query("SELECT * FROM evidence LIMIT 0");
    await pool.query("SELECT * FROM ocr_runs LIMIT 0");
    await pool.query("SELECT * FROM ai_flags LIMIT 0");
    await pool.query("SELECT * FROM ocr_jobs LIMIT 0");
    await pool.query("SELECT * FROM verifier_wallets LIMIT 0");
    await pool.query("SELECT * FROM review_rounds LIMIT 0");
    await pool.query("SELECT * FROM review_assignments LIMIT 0");
    await pool.query("SELECT * FROM review_votes LIMIT 0");
    await pool.query("SELECT * FROM review_vote_submissions LIMIT 0");
    await pool.query("SELECT * FROM verifications LIMIT 0");
    await pool.query("SELECT * FROM verifier_wallet_challenges LIMIT 0");
    await pool.query("SELECT * FROM proofs LIMIT 0");
    await pool.query("SELECT * FROM terms_acceptances LIMIT 0");

    assert.equal(await rollbackLastMigration(pool), "010_ai_enrichment");
    await assert.rejects(pool.query("SELECT ai_enrichment FROM ocr_runs"));
    assert.equal(await rollbackLastMigration(pool), "009_campaign_publication");
    await assert.rejects(pool.query("SELECT publicly_published_at FROM campaigns"));
    assert.equal(await rollbackLastMigration(pool), "008_proof_schema_version");
    await assert.rejects(pool.query("SELECT package_schema_version FROM proofs"));
    await pool.query("SELECT * FROM organizations LIMIT 0");
    await pool.query("SELECT * FROM proofs LIMIT 0");
    await pool.query("SELECT * FROM verifier_wallets LIMIT 0");
    await pool.query("SELECT * FROM ocr_runs LIMIT 0");
    await pool.query("SELECT * FROM campaigns LIMIT 0");
    await pool.query("SELECT * FROM organizations LIMIT 0");
  } finally {
    await pool.end();
  }
});
