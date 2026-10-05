import express from "express";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb", strict: true }));

  app.get("/api/health", (_request, response) => {
    response.status(200).json({ status: "ok", service: "dana-terang-api" });
  });

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
