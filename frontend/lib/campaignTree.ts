import { requestJson } from "./api";

export type CampaignSummary = {
  id: string;
  title: string;
  description?: string;
  totalBudget: string;
  currency: string;
  status: string;
  organizationId: string;
};

export type MilestoneSummary = {
  id: string;
  campaignId: string;
  title: string;
  description?: string;
  budgetAmount: string;
  currency: string;
  orderIndex: number;
  status: "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
};

export type EvidenceSummary = {
  id: string;
  milestoneId: string;
  evidenceType?: string;
  fileName?: string;
  contentType?: string;
  fileSize?: number;
  version?: number;
  evidenceStatus: string;
  screeningStatus?: string | null;
  verificationStatus?: string | null;
  revisionInstructions?: string;
  flags?: { code: string; field: string | null; severity: "LOW" | "MEDIUM" | "HIGH"; message: string }[];
};

export type CampaignTree = {
  campaigns: CampaignSummary[];
  milestones: MilestoneSummary[];
  evidence: EvidenceSummary[];
};

export class CampaignTreeError extends Error {
  constructor(readonly failedRequest: string) {
    super(failedRequest);
    this.name = "CampaignTreeError";
  }
}

/**
 * Loads campaigns with their milestones and evidence.
 *
 * Each milestone's evidence is a separate request, so a failed evidence request
 * must not be reported as "no evidence". When any nested request fails the
 * partially loaded tree is returned together with a CampaignTreeError so callers
 * can show a recoverable error instead of a silently empty list.
 */
export async function loadCampaignTree(): Promise<CampaignTree> {
  const campaignResponse = await requestJson<{ campaigns: CampaignSummary[] }>("/api/campaigns");
  const campaigns = campaignResponse.campaigns ?? [];

  const milestoneGroups = await Promise.all(
    campaigns.map((campaign) =>
      requestJson<{ milestones: MilestoneSummary[] }>(`/api/campaigns/${campaign.id}/milestones`)
        .then((response) => response.milestones ?? [])
        .catch(() => {
          throw new CampaignTreeError(`GET /api/campaigns/${campaign.id}/milestones`);
        }),
    ),
  );
  const milestones = milestoneGroups.flat();

  const evidenceGroups = await Promise.all(
    milestones.map((milestone) =>
      requestJson<{ evidence: EvidenceSummary[] }>(`/api/milestones/${milestone.id}/evidence`)
        .then((response) => response.evidence ?? [])
        .catch(() => {
          throw new CampaignTreeError(`GET /api/milestones/${milestone.id}/evidence`);
        }),
    ),
  );

  return { campaigns, milestones, evidence: evidenceGroups.flat() };
}
