import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";

import { createAuthService } from "./auth/authService.js";
import { createEvidenceService } from "./evidence/evidenceService.js";
import { createAdminRouter } from "./routes/admin.js";
import { createAuthRouter } from "./routes/auth.js";
import { createCampaignRouter } from "./routes/campaigns.js";
import { createEvidenceRouter } from "./routes/evidence.js";
import { createProofRouter } from "./routes/proofs.js";
import { createPublicRouter } from "./routes/publicAudit.js";
import { createReviewRouter } from "./routes/reviews.js";

export function createApp({ authRepository, campaignRepository, evidenceRepository, reviewRepository, peerReviewService, proofRepository, proofService, testWalletSigner, objectStorage, maxEvidenceBytes, webOrigin = process.env.WEB_ORIGIN, nodeEnv = process.env.NODE_ENV } = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.use(cors({
    origin: (origin, callback) => callback(null, webOrigin && origin === webOrigin ? webOrigin : false),
    credentials: true,
    methods: ["GET", "POST", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  }));
  app.use(express.json({ limit: "1mb", strict: true }));
  app.use(cookieParser());

  app.get("/api/health", (_request, response) => {
    response.status(200).json({ status: "ok", service: "dana-terang-api" });
  });

  app.get("/", (request, response) => {
    const frontendTarget = webOrigin || "http://localhost:3000";
    if (request.accepts("html")) {
      return response.status(200).send(`
        <!DOCTYPE html>
        <html lang="id">
          <head>
            <meta charset="utf-8">
            <title>DanaTerang API Service</title>
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
              body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #101A2B; color: #FFFFFF; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }
              .card { background: #FFFFFF; color: #101A2B; border: 2px solid #101A2B; border-radius: 8px; box-shadow: 4px 4px 0px #0D9488; padding: 32px; max-width: 480px; text-align: center; }
              h1 { font-size: 20px; text-transform: uppercase; margin: 12px 0 8px; font-weight: 800; }
              p { font-size: 14px; line-height: 1.5; color: #475569; margin: 0 0 16px; }
              .badge { background: #DDF78A; color: #101A2B; font-weight: 700; padding: 4px 10px; border-radius: 4px; display: inline-block; font-size: 11px; text-transform: uppercase; border: 1.5px solid #101A2B; box-shadow: 1.5px 1.5px 0px #101A2B; }
              a.btn { display: inline-flex; align-items: center; justify-content: center; background: #101A2B; color: #FFFFFF; text-decoration: none; font-weight: 800; font-size: 13px; text-transform: uppercase; padding: 10px 20px; border-radius: 4px; margin-top: 12px; border: 2px solid #101A2B; box-shadow: 2.5px 2.5px 0px #0D9488; transition: all 120ms ease; }
              a.btn:hover { background: #0D9488; transform: translate(-1px, -1px); box-shadow: 3.5px 3.5px 0px #101A2B; }
            </style>
          </head>
          <body>
            <div class="card">
              <span class="badge">DanaTerang API Service v0.1.0</span>
              <h1>Backend Berjalan Aktif</h1>
              <p>Halaman ini adalah endpoint REST API (port 4000). Untuk membuka tampilan Web App dan Dashboard, silakan buka port 3000:</p>
              <a class="btn" href="${frontendTarget}">Buka Web App (localhost:3000) &rarr;</a>
            </div>
          </body>
        </html>
      `);
    }
    response.status(200).json({
      status: "ok",
      service: "dana-terang-api",
      message: "Backend API is running. Access the web app at http://localhost:3000",
      frontendUrl: frontendTarget,
    });
  });

  if (typeof campaignRepository?.publicCampaignProjection === "function") {
    app.use("/api", createPublicRouter({ campaignRepository }));
  }

  if (authRepository) {
    const authService = createAuthService({ authRepository });
    app.use("/api/auth", createAuthRouter({ authService, webOrigin, nodeEnv }));
    app.use("/api/admin", createAdminRouter({ authRepository, authService, campaignRepository, webOrigin }));
    if (reviewRepository && peerReviewService) {
      app.use("/api", createReviewRouter({ reviewRepository, peerReviewService, evidenceRepository, authService, webOrigin }));
    }
    if (proofRepository && proofService) {
      app.use("/api", createProofRouter({ proofRepository, proofService, authService, webOrigin }));
    }
    if (nodeEnv === "test" && typeof testWalletSigner === "function") {
      app.post("/api/test/wallet/sign", async (request, response, next) => {
        response.set("Cache-Control", "private, no-store");
        if (!webOrigin || request.get("origin") !== webOrigin) return response.status(403).json({ error: "forbidden" });
        try {
          const user = await authService.loadSessionUser(request.cookies?.dt_session);
          if (!user) return response.status(401).json({ error: "authentication_required" });
          if (user.role !== "VERIFIER") return response.status(403).json({ error: "forbidden" });
          if (!request.body || Object.keys(request.body).length !== 2
              || typeof request.body.address !== "string" || !request.body.typedData) {
            return response.status(400).json({ error: "invalid_request" });
          }
          const signature = await testWalletSigner({ actor: user, address: request.body.address, typedData: request.body.typedData });
          return response.status(200).json({ signature });
        } catch (error) {
          return next(error);
        }
      });
    }
    if (campaignRepository) {
      app.use("/api", createCampaignRouter({ campaignRepository, authService, webOrigin }));
    }
    if (evidenceRepository && objectStorage) {
      const evidenceService = createEvidenceService({ evidenceRepository, storage: objectStorage, maxBytes: maxEvidenceBytes });
      app.use("/api", createEvidenceRouter({ evidenceRepository, evidenceService, storage: objectStorage, authService, webOrigin, maxBytes: maxEvidenceBytes }));
    }
  }

  app.use((_request, response) => {
    response.status(404).json({ error: "not_found" });
  });

  app.use((error, _request, response, next) => {
    if (response.headersSent) return next(error);
    const status = error.status === 413 ? 413 : error.status === 400 ? 400 : 500;
    const code = status === 413 ? "request_too_large" : status === 400 ? "invalid_json" : "internal_error";
    response.status(status).json({ error: code });
  });

  return app;
}
