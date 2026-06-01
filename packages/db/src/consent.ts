// Consent ledger (ADR-0019).
//
// Append-only: one row per consent state change. The latest row per
// (user_id, consent_type) is authoritative — readers sort by createdAt desc.
// Every write goes through withOrg(ctx), so a ConsentRecord can only ever be
// attributed to a user inside the caller's own org.
//
// Pre-auth cookie choices are NOT written here — they live in a first-party
// cookie until the chooser is an authenticated user, at which point the web
// layer snapshots them via recordConsents(). That keeps every persisted row
// genuinely org-scoped (no anonymous, org-less rows). See ADR-0019 D5.

import { type ConsentType } from "@prisma/client";
import { withOrg, type OrgContext } from "./tenancy";

export type ConsentInput = {
  consent_type: ConsentType;
  granted: boolean;
  /** Policy registry version this consent was given against. */
  policy_version: string;
  /** Capture surface: "signup" | "cookie_banner" | "speaking_gate" | "profile" | "guardian". */
  source: string;
  /** Salted hash of the requester IP — never the raw address. */
  ip_hash?: string | null;
  user_agent?: string | null;
};

export type ConsentSnapshot = {
  consent_type: ConsentType;
  granted: boolean;
  policy_version: string;
  source: string;
  createdAt: Date;
};

/** Record a single consent state change for the caller. */
export async function recordConsent(
  ctx: OrgContext,
  input: ConsentInput,
): Promise<{ id: string }> {
  const db = withOrg(ctx);
  const row = await db.consentRecord.create({
    data: {
      org_id: ctx.org_id,
      user_id: ctx.user_id,
      consent_type: input.consent_type,
      granted: input.granted,
      policy_version: input.policy_version,
      source: input.source,
      ip_hash: input.ip_hash ?? null,
      user_agent: input.user_agent ?? null,
    },
    select: { id: true },
  });
  return row;
}

/** Record several consent changes atomically (e.g. the sign-up snapshot). */
export async function recordConsents(
  ctx: OrgContext,
  inputs: ConsentInput[],
): Promise<number> {
  if (inputs.length === 0) return 0;
  const db = withOrg(ctx);
  const res = await db.consentRecord.createMany({
    data: inputs.map((input) => ({
      org_id: ctx.org_id,
      user_id: ctx.user_id,
      consent_type: input.consent_type,
      granted: input.granted,
      policy_version: input.policy_version,
      source: input.source,
      ip_hash: input.ip_hash ?? null,
      user_agent: input.user_agent ?? null,
    })),
  });
  return res.count;
}

/**
 * Latest consent state per type for the caller. Returns at most one row per
 * ConsentType (the most recent). Types never consented to are absent.
 */
export async function getMyConsents(
  ctx: OrgContext,
): Promise<Record<string, ConsentSnapshot>> {
  const db = withOrg(ctx);
  const rows = await db.consentRecord.findMany({
    where: { user_id: ctx.user_id },
    orderBy: { createdAt: "desc" },
    select: {
      consent_type: true,
      granted: true,
      policy_version: true,
      source: true,
      createdAt: true,
    },
  });
  const latest: Record<string, ConsentSnapshot> = {};
  for (const row of rows) {
    // rows are newest-first, so the first time we see a type is the latest.
    if (!(row.consent_type in latest)) {
      latest[row.consent_type] = row;
    }
  }
  return latest;
}

/** True iff the caller's latest state for `type` is granted. */
export async function hasGrantedConsent(
  ctx: OrgContext,
  type: ConsentType,
): Promise<boolean> {
  const db = withOrg(ctx);
  const row = await db.consentRecord.findFirst({
    where: { user_id: ctx.user_id, consent_type: type },
    orderBy: { createdAt: "desc" },
    select: { granted: true },
  });
  return row?.granted === true;
}

// Re-export the Prisma enum so consumers don't reach into @prisma/client.
export { type ConsentType };
