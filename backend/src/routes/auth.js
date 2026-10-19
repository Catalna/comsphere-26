import { Router } from "express";
import rateLimit from "express-rate-limit";

import { HttpError } from "../auth/errors.js";
import { SESSION_COOKIE_NAME, SESSION_LIFETIME_SECONDS } from "../auth/sessionConstants.js";
import { createSessionMiddleware } from "../middleware/session.js";

const RELAXED_AUTH_LIMIT = 1000;

function createLimiter(limit, nodeEnv) {
  // Demo convenience only: unlock tight auth limits locally via RELAX_AUTH_RATE_LIMITS=true
  // (backend/.env). Production always uses the configured limits.
  const relaxed = nodeEnv !== "production" && process.env.RELAX_AUTH_RATE_LIMITS === "true";
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: relaxed ? RELAXED_AUTH_LIMIT : limit,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_request, response) => response.status(429).json({ error: "rate_limited" }),
  });
}

function requireConfiguredOrigin(webOrigin) {
  return function checkOrigin(request, response, next) {
    if (!webOrigin || request.get("origin") !== webOrigin) {
      return response.status(403).json({ error: "forbidden" });
    }
    return next();
  };
}

function setSessionCookie(response, token, secure) {
  response.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: SESSION_LIFETIME_SECONDS * 1000,
  });
}

function clearSessionCookie(response, secure) {
  response.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
  });
}

function sendAuthError(error, response, next) {
  if (error instanceof HttpError) return response.status(error.status).json({ error: error.code });
  return next(error);
}

export function createAuthRouter({ authService, webOrigin, nodeEnv = process.env.NODE_ENV }) {
  const router = Router();
  const secureCookie = nodeEnv === "production";
  const originCheck = requireConfiguredOrigin(webOrigin);
  const requireSession = createSessionMiddleware(authService);
  router.use((_request, response, next) => {
    response.set("Cache-Control", "no-store");
    return next();
  });

  router.post("/register", originCheck, createLimiter(5, nodeEnv), async (request, response, next) => {
    try {
      const result = await authService.register(request.body);
      setSessionCookie(response, result.token, secureCookie);
      return response.status(201).json({ user: result.user });
    } catch (error) {
      return sendAuthError(error, response, next);
    }
  });

  router.post("/login", originCheck, createLimiter(10, nodeEnv), async (request, response, next) => {
    try {
      const result = await authService.login(request.body);
      setSessionCookie(response, result.token, secureCookie);
      return response.status(200).json({ user: result.user });
    } catch (error) {
      return sendAuthError(error, response, next);
    }
  });

  router.get("/me", requireSession, (request, response) => {
    const { id, name, email, role, organizationId, organization } = request.currentUser;
    return response.status(200).json({ user: { id, name, email, role, organizationId, organization } });
  });

  router.post("/logout", originCheck, requireSession, async (request, response, next) => {
    try {
      await authService.logout(request.cookies?.[SESSION_COOKIE_NAME]);
      clearSessionCookie(response, secureCookie);
      return response.status(204).end();
    } catch (error) {
      return next(error);
    }
  });

  return router;
}
