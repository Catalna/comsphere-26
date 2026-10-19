import { Router } from "express";

import { parseCampaignPublication, parseOrganizationVerification, parseRoleUpdate, isUserId } from "../auth/validation.js";
import { createSessionMiddleware } from "../middleware/session.js";
import { requireRole } from "../middleware/requireRole.js";

function requireConfiguredOrigin(webOrigin) {
  return function checkOrigin(request, response, next) {
    if (!webOrigin || request.get("origin") !== webOrigin) {
      return response.status(403).json({ error: "forbidden" });
    }
    return next();
  };
}

function statusForRepositoryError(error) {
  if (error?.code === "USER_NOT_FOUND" || error?.code === "ORGANIZATION_NOT_FOUND") return 404;
  if (error?.code === "CAMPAIGN_NOT_FOUND") return 404;
  if (error?.code === "FORBIDDEN" || error?.code === "ADMIN_ROLE_PROTECTED") return 403;
  if (error?.code === "ORGANIZATION_REQUIRED") return 400;
  return null;
}

export function createAdminRouter({ authRepository, authService, campaignRepository, webOrigin }) {
  const router = Router();
  router.use((_request, response, next) => {
    response.set("Cache-Control", "no-store");
    return next();
  });
  router.get(
    "/users",
    createSessionMiddleware(authService),
    requireRole("ADMIN"),
    async (_request, response, next) => {
      try {
        const users = await authRepository.listUsersForAdmin();
        return response.status(200).json({
          users: users.map(({ id, name, email, role, organizationId, organization }) => ({
            id, name, email, role, organizationId, organization,
          })),
        });
      } catch (error) {
        return next(error);
      }
    },
  );
  router.get(
    "/campaigns",
    createSessionMiddleware(authService),
    requireRole("ADMIN"),
    async (_request, response, next) => {
      try {
        if (typeof campaignRepository?.listCampaignPublications !== "function") {
          return response.status(503).json({ error: "unavailable" });
        }
        const campaigns = await campaignRepository.listCampaignPublications();
        return response.status(200).json({ campaigns });
      } catch (error) {
        return next(error);
      }
    },
  );
  router.patch(
    "/users/:userId/role",
    requireConfiguredOrigin(webOrigin),
    createSessionMiddleware(authService),
    requireRole("ADMIN"),
    async (request, response, next) => {
      if (!isUserId(request.params.userId)) return response.status(400).json({ error: "invalid_request" });
      const input = parseRoleUpdate(request.body);
      if (!input) return response.status(400).json({ error: "invalid_request" });

      try {
        const user = await authRepository.assignRoleAndAudit({
          actorUserId: request.currentUser.id,
          targetUserId: request.params.userId,
          role: input.role,
        });
        const { id, name, email, role, organizationId, organization } = user;
        return response.status(200).json({ user: { id, name, email, role, organizationId, organization } });
      } catch (error) {
        const status = statusForRepositoryError(error);
        if (status) return response.status(status).json({ error: status === 404 ? "not_found" : status === 403 ? "forbidden" : "invalid_request" });
        return next(error);
      }
    },
  );
  router.get(
    "/organizations",
    createSessionMiddleware(authService),
    requireRole("ADMIN"),
    async (_request, response, next) => {
      try {
        const organizations = await authRepository.listOrganizationsForAdmin();
        return response.status(200).json({ organizations });
      } catch (error) {
        return next(error);
      }
    },
  );
  router.patch(
    "/organizations/:organizationId/verification",
    requireConfiguredOrigin(webOrigin),
    createSessionMiddleware(authService),
    requireRole("ADMIN"),
    async (request, response, next) => {
      if (!isUserId(request.params.organizationId)) return response.status(400).json({ error: "invalid_request" });
      const input = parseOrganizationVerification(request.body);
      if (!input) return response.status(400).json({ error: "invalid_request" });

      try {
        const organization = await authRepository.setOrganizationVerification({
          actorUserId: request.currentUser.id,
          organizationId: request.params.organizationId,
          verified: input.verified,
        });
        return response.status(200).json({ organization });
      } catch (error) {
        const status = statusForRepositoryError(error);
        if (status) return response.status(status).json({ error: status === 404 ? "not_found" : status === 403 ? "forbidden" : "invalid_request" });
        return next(error);
      }
    },
  );
  router.patch(
    "/campaigns/:campaignId/publication",
    requireConfiguredOrigin(webOrigin),
    createSessionMiddleware(authService),
    requireRole("ADMIN"),
    async (request, response, next) => {
      if (!isUserId(request.params.campaignId)) return response.status(400).json({ error: "invalid_request" });
      const input = parseCampaignPublication(request.body);
      if (!input) return response.status(400).json({ error: "invalid_request" });
      if (typeof campaignRepository?.setCampaignPublication !== "function") {
        return response.status(503).json({ error: "unavailable" });
      }

      try {
        const campaign = await campaignRepository.setCampaignPublication({
          actor: request.currentUser,
          campaignId: request.params.campaignId,
          published: input.published,
        });
        return response.status(200).json({ campaign });
      } catch (error) {
        const status = statusForRepositoryError(error);
        if (status) return response.status(status).json({ error: status === 404 ? "not_found" : status === 403 ? "forbidden" : "invalid_request" });
        return next(error);
      }
    },
  );
  return router;
}
