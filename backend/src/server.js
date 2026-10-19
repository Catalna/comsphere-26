import "dotenv/config";

import { createApp } from "./app.js";
import { readApiConfig } from "./config.js";
import { readOcrConfig } from "./ocr/config.js";
import { createAiEnricher } from "./ocr/aiEnricher.js";
import { createDocumentRasterizer } from "./ocr/documentRasterizer.js";
import { createOcrWorker } from "./ocr/ocrWorker.js";
import { createTesseractEngine } from "./ocr/tesseractEngine.js";
import { runMigrations } from "./db/migrate.js";
import { createPool } from "./db/pool.js";
import { readPeerReviewConfig } from "./review/config.js";
import { createPeerReviewChain } from "./review/chain.js";
import { createPeerReviewService } from "./review/peerReviewService.js";
import { readProofAnchorConfig } from "./proof/config.js";
import { createProofAnchorChain } from "./proof/anchorChain.js";
import { createProofService } from "./proof/proofService.js";
import { createObjectStorage } from "./storage/objectStorage.js";
import { createAuthRepository } from "./repositories/authRepository.js";
import { createCampaignRepository } from "./repositories/campaignRepository.js";
import { createEvidenceRepository } from "./repositories/evidenceRepository.js";
import { createOcrRepository } from "./repositories/ocrRepository.js";
import { createProofRepository } from "./repositories/proofRepository.js";
import { createReviewRepository } from "./repositories/reviewRepository.js";

async function startServer() {
  const config = readApiConfig();
  const peerReviewConfig = readPeerReviewConfig();
  const proofAnchorConfig = readProofAnchorConfig();
  let pool = null;
  let server = null;
  let ocrWorker = null;
  let peerReviewChain = null;
  let proofAnchorChain = null;
  let reviewRegistrarTimer = null;

  try {
    if (peerReviewConfig && !config.databaseUrl) {
      throw Object.assign(new Error("Peer review requires a configured database"), { code: "PEER_REVIEW_DATABASE_REQUIRED" });
    }
    if (config.databaseUrl) {
      pool = createPool(config.databaseUrl);
      await pool.query("SELECT 1");
      if (config.autoMigrate) {
        const applied = await runMigrations(pool);
        console.log(`Development startup applied ${applied.length} database migration(s).`);
      }
    }

    if (pool && peerReviewConfig) peerReviewChain = await createPeerReviewChain(peerReviewConfig);
    if (pool && proofAnchorConfig) proofAnchorChain = await createProofAnchorChain(proofAnchorConfig);
    const authRepository = pool ? createAuthRepository(pool) : undefined;
    const campaignRepository = pool ? createCampaignRepository(pool) : undefined;
    const reviewRepository = pool && peerReviewChain
      ? createReviewRepository(pool, { contractAddress: peerReviewChain.contractAddress })
      : undefined;
    const proofRepository = pool ? createProofRepository(pool) : undefined;
    const proofService = pool
      ? createProofService({
        repository: proofRepository,
        anchorContract: proofAnchorChain?.contract ?? null,
        contractAddress: proofAnchorChain?.contractAddress ?? null,
      })
      : undefined;
    const peerReviewService = peerReviewChain
      ? createPeerReviewService({
        repository: reviewRepository,
        contract: peerReviewChain.contract,
        chainId: peerReviewConfig.chainId,
        contractAddress: peerReviewChain.contractAddress,
        onQuorumFinalized: proofService
          ? ({ reviewRoundId, now }) => proofService.handleQuorumFinalized({ reviewRoundId, now })
          : null,
      })
      : undefined;
    const evidenceRepository = pool ? createEvidenceRepository(pool, { reviewRepository }) : undefined;
    const ocrRepository = pool ? createOcrRepository(pool, { reviewRepository }) : undefined;
    const ocrConfig = pool ? readOcrConfig() : null;
    const objectStorage = pool ? createObjectStorage({
      mode: process.env.STORAGE_MODE ?? "local",
      localRoot: process.env.LOCAL_OBJECT_STORAGE_ROOT ?? "../.local/evidence",
      endpoint: process.env.STORAGE_ENDPOINT,
      bucket: process.env.STORAGE_BUCKET,
      accessKeyId: process.env.STORAGE_ACCESS_KEY,
      secretAccessKey: process.env.STORAGE_SECRET_KEY,
      region: process.env.STORAGE_REGION ?? "auto",
      forcePathStyle: process.env.STORAGE_FORCE_PATH_STYLE === "true",
    }) : undefined;
    const maxEvidenceBytes = Number(process.env.MAX_EVIDENCE_BYTES ?? 10 * 1024 * 1024);
    if (pool && objectStorage && ocrRepository && ocrConfig) {
      const enricher = createAiEnricher({ config: ocrConfig.gemini });
      ocrWorker = createOcrWorker({
        repository: ocrRepository,
        storage: objectStorage,
        renderer: createDocumentRasterizer(),
        engine: createTesseractEngine({ languageDataPath: ocrConfig.languageDataPath }),
        enricher,
        aiMaxPages: ocrConfig.gemini.maxPages,
        thresholds: ocrConfig.thresholds,
        pollIntervalMs: ocrConfig.pollIntervalMs,
        leaseMs: ocrConfig.leaseMs,
        maxAttempts: ocrConfig.maxAttempts,
        maxPdfPages: ocrConfig.maxPdfPages,
        renderDpi: ocrConfig.renderDpi,
        maxImagePixels: ocrConfig.maxImagePixels,
        maxEvidenceBytes,
        onError: ({ code }) => console.error(`OCR background worker error: ${code}`),
      });
    }
    server = createApp({
      authRepository,
      campaignRepository,
      evidenceRepository,
      reviewRepository,
      peerReviewService,
      proofRepository,
      proofService,
      objectStorage,
      maxEvidenceBytes,
      webOrigin: config.webOrigin,
      nodeEnv: config.nodeEnv,
    })
      .listen(config.port, config.host);
    await new Promise((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });

    console.log(`DanaTerang API listening on ${config.host}:${config.port}${pool ? " with PostgreSQL" : " in health-only mode"}.`);
    console.log(`AI OCR enrichment: ${ocrConfig?.gemini.enabled ? `enabled (model ${ocrConfig.gemini.model}, max ${ocrConfig.gemini.maxPages} pages)` : "disabled"}.`);
    if (ocrWorker) {
      ocrWorker.start().catch(() => {
        console.error("OCR background worker stopped unexpectedly.");
        process.exitCode = 1;
      });
    }
    if (peerReviewService) {
      let reviewTasksRunning = false;
      const runPeerReviewTasks = async () => {
        if (reviewTasksRunning) return;
        reviewTasksRunning = true;
        try {
          await peerReviewService.registerWaitingRounds();
          await peerReviewService.reconcilePendingVoteSubmissions();
          if (proofService) {
            const retried = await proofService.retryFailedProofs();
            if (retried.length > 0) {
              console.log(`Proof anchor retry attempted for ${retried.length} proof(s).`);
            }
          }
        } catch {
          console.error("Peer-review chain background tasks encountered an error.");
        } finally {
          reviewTasksRunning = false;
        }
      };
      runPeerReviewTasks();
      reviewRegistrarTimer = setInterval(runPeerReviewTasks, 30_000);
      reviewRegistrarTimer.unref?.();
    }

    let shuttingDown = false;
    for (const signal of ["SIGINT", "SIGTERM"]) {
      process.once(signal, () => {
        if (shuttingDown) return;
        shuttingDown = true;
        clearInterval(reviewRegistrarTimer);
        server.close(async (error) => {
          await ocrWorker?.stop();
          await peerReviewChain?.close();
          await pool?.end();
          if (error) {
            console.error("DanaTerang API shutdown encountered an error.");
            process.exitCode = 1;
          }
        });
      });
    }
  } catch (error) {
    if (server?.listening) server.close();
    clearInterval(reviewRegistrarTimer);
    await peerReviewChain?.close();
    await pool?.end();
    throw error;
  }
}

startServer().catch((error) => {
  console.error("DanaTerang API startup failed:", error);
  process.exitCode = 1;
});
