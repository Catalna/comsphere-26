import { Router } from "express";

import { isUserId } from "../auth/validation.js";

/**
 * Public, unauthenticated audit surface.
 *
 * Only campaigns an Admin explicitly published are returned, and only the
 * allowlisted projection built by the campaign repository. Original evidence,
 * filenames, OCR content, payment references, private review notes, and account
 * identities are never included.
 */
export function createPublicRouter({ campaignRepository }) {
  const router = Router();

  router.use((_request, response, next) => {
    response.set("Cache-Control", "no-store");
    return next();
  });

  router.get("/public/campaigns", async (_request, response, next) => {
    try {
      const campaigns = await campaignRepository.listPublishedCampaigns();
      return response.status(200).json({ campaigns });
    } catch (error) {
      return next(error);
    }
  });

  router.get("/public/campaigns/:campaignId", async (request, response, next) => {
    if (!isUserId(request.params.campaignId)) return response.status(400).json({ error: "invalid_request" });
    try {
      const campaign = await campaignRepository.publicCampaignProjection(request.params.campaignId);
      if (!campaign) return response.status(404).json({ error: "not_found" });
      return response.status(200).json({ campaign });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}
