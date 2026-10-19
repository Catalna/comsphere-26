import { Router } from "express";
import { InvalidStateTransitionError } from "@dana-terang/domain";

import { HttpError } from "../auth/errors.js";
import {
  isUserId,
  parseCampaignCreate,
  parseCampaignUpdate,
  parseMilestoneCreate,
  parseMilestoneStatus,
} from "../auth/validation.js";
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

function sendError(error, response, next) {
  if (error instanceof HttpError) return response.status(error.status).json({ error: error.code });
  if (error instanceof InvalidStateTransitionError) return response.status(400).json({ error: "invalid_transition" });
  const responseForCode = {
    FORBIDDEN: [403, "forbidden"],
    CAMPAIGN_NOT_FOUND: [404, "not_found"],
    MILESTONE_NOT_FOUND: [404, "not_found"],
    FUNDER_NOT_AVAILABLE: [400, "invalid_request"],
    INVALID_AMOUNT: [400, "invalid_request"],
    INVALID_CURRENCY: [400, "invalid_request"],
    INVALID_FUNDING_MODE: [400, "invalid_request"],
    INVALID_ORDER_INDEX: [400, "invalid_request"],
    INVALID_DATE_RANGE: [400, "invalid_request"],
    CURRENCY_MISMATCH: [400, "invalid_request"],
    BUDGET_CONSTRAINT: [400, "invalid_request"],
    CAMPAIGN_NOT_EDITABLE: [409, "campaign_conflict"],
    CAMPAIGN_NOT_ACTIVATABLE: [409, "campaign_conflict"],
    CAMPAIGN_NOT_ACTIVE: [409, "campaign_conflict"],
    MILESTONES_REQUIRED: [409, "milestones_required"],
    "23505": [409, "conflict"],
  }[error?.code];
  if (responseForCode) return response.status(responseForCode[0]).json({ error: responseForCode[1] });
  return next(error);
}

export function createCampaignRouter({ campaignRepository, authService, webOrigin }) {
  const router = Router();
  const requireSession = createSessionMiddleware(authService);
  const originCheck = requireConfiguredOrigin(webOrigin);
  router.use((_request, response, next) => {
    response.set("Cache-Control", "no-store");
    return next();
  });

  router.get("/funders", requireSession, requireRole("ADMIN", "ORGANIZER"), async (_request, response, next) => {
    try {
      const funders = await campaignRepository.listEligibleFunders();
      return response.status(200).json({ funders });
    } catch (error) {
      return sendError(error, response, next);
    }
  });

  router.get("/campaigns", requireSession, requireRole("ADMIN", "ORGANIZER", "FUNDER"), async (request, response, next) => {
    try {
      const campaigns = await campaignRepository.listCampaignsForUser(request.currentUser);
      return response.status(200).json({ campaigns });
    } catch (error) {
      return sendError(error, response, next);
    }
  });

  router.post("/campaigns", originCheck, requireSession, requireRole("ORGANIZER"), async (request, response, next) => {
    const input = parseCampaignCreate(request.body);
    if (!input) return response.status(400).json({ error: "invalid_request" });
    try {
      const campaign = await campaignRepository.createCampaign({ actor: request.currentUser, ...input });
      return response.status(201).json({ campaign });
    } catch (error) {
      return sendError(error, response, next);
    }
  });

  router.get("/campaigns/:campaignId", requireSession, requireRole("ADMIN", "ORGANIZER", "FUNDER"), async (request, response, next) => {
    if (!isUserId(request.params.campaignId)) return response.status(400).json({ error: "invalid_request" });
    try {
      const campaign = await campaignRepository.getCampaignForUser(request.currentUser, request.params.campaignId);
      if (!campaign) return response.status(404).json({ error: "not_found" });
      return response.status(200).json({ campaign });
    } catch (error) {
      return sendError(error, response, next);
    }
  });

  router.patch("/campaigns/:campaignId", originCheck, requireSession, requireRole("ADMIN", "ORGANIZER"), async (request, response, next) => {
    if (!isUserId(request.params.campaignId)) return response.status(400).json({ error: "invalid_request" });
    const patch = parseCampaignUpdate(request.body);
    if (!patch) return response.status(400).json({ error: "invalid_request" });
    try {
      const campaign = await campaignRepository.updateCampaignDraft({ actor: request.currentUser, campaignId: request.params.campaignId, patch });
      return response.status(200).json({ campaign });
    } catch (error) {
      return sendError(error, response, next);
    }
  });

  router.post("/campaigns/:campaignId/activate", originCheck, requireSession, requireRole("ADMIN", "FUNDER"), async (request, response, next) => {
    if (!isUserId(request.params.campaignId)) return response.status(400).json({ error: "invalid_request" });
    try {
      const campaign = await campaignRepository.activateCampaign({ actor: request.currentUser, campaignId: request.params.campaignId });
      return response.status(200).json({ campaign });
    } catch (error) {
      return sendError(error, response, next);
    }
  });

  router.get("/campaigns/:campaignId/milestones", requireSession, requireRole("ADMIN", "ORGANIZER", "FUNDER"), async (request, response, next) => {
    if (!isUserId(request.params.campaignId)) return response.status(400).json({ error: "invalid_request" });
    try {
      const milestones = await campaignRepository.listMilestonesForCampaign(request.currentUser, request.params.campaignId);
      if (!milestones) return response.status(404).json({ error: "not_found" });
      return response.status(200).json({ milestones });
    } catch (error) {
      return sendError(error, response, next);
    }
  });

  router.post("/campaigns/:campaignId/milestones", originCheck, requireSession, requireRole("ORGANIZER"), async (request, response, next) => {
    if (!isUserId(request.params.campaignId)) return response.status(400).json({ error: "invalid_request" });
    const input = parseMilestoneCreate(request.body);
    if (!input) return response.status(400).json({ error: "invalid_request" });
    try {
      const milestone = await campaignRepository.createMilestone({ actor: request.currentUser, campaignId: request.params.campaignId, ...input });
      return response.status(201).json({ milestone });
    } catch (error) {
      return sendError(error, response, next);
    }
  });

  router.patch("/milestones/:milestoneId", originCheck, requireSession, requireRole("ORGANIZER"), async (request, response, next) => {
    if (!isUserId(request.params.milestoneId)) return response.status(400).json({ error: "invalid_request" });
    const input = parseMilestoneStatus(request.body);
    if (!input) return response.status(400).json({ error: "invalid_request" });
    try {
      const milestone = await campaignRepository.updateMilestoneStatus({ actor: request.currentUser, milestoneId: request.params.milestoneId, ...input });
      return response.status(200).json({ milestone });
    } catch (error) {
      return sendError(error, response, next);
    }
  });

  return router;
}
