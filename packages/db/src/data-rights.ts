// Data-subject rights (ADR-0019).
//
// Self-service access / portability / erasure / rectification for the
// authenticated caller. Every query is scoped through withOrg(ctx) AND
// further pinned to ctx.user_id, so a learner can only ever export or erase
// their own data — never another learner's, and never across orgs. The
// tenancy fuzzer asserts the cross-org half of that guarantee.
//
// Erasure is queued (a Pending DataRightsRequest), not instant: the actual
// PII scrub runs from the retention job after a short cancellation window so
// an accidental click is recoverable. See retention.ts + ADR-0019 D4.

import { Prisma, type DataRightType, type AgeAssurance } from "@prisma/client";
import { withOrg, type OrgContext } from "./tenancy";

// ─── Export bundle ────────────────────────────────────────────────────────

export type UserDataExport = {
  generated_at: string;
  subject: {
    id: string;
    email: string;
    name: string | null;
    role: string;
    ielts_track: string;
    age_assurance: AgeAssurance;
    created_at: string;
  };
  organization: { id: string; name: string };
  consents: Array<{
    consent_type: string;
    granted: boolean;
    policy_version: string;
    source: string;
    recorded_at: string;
  }>;
  data_rights_requests: Array<{
    type: string;
    status: string;
    requested_at: string;
    fulfilled_at: string | null;
  }>;
  attempts: Array<{
    id: string;
    section: string;
    status: string;
    started_at: string;
    submitted_at: string | null;
    grade: {
      band_overall: string;
      criteria_scores: Prisma.JsonValue;
      feedback_text: string | null;
    } | null;
    answers: Array<{ question_id: string; response: Prisma.JsonValue; is_correct: boolean | null }>;
    // Recording metadata only — never the raw R2 key. The export route
    // attaches short-lived signed download URLs separately. See ADR-0019 D6.
    recording: { duration_sec: number; created_at: string } | null;
  }>;
  activity_log: Array<{ action: string; timestamp: string; metadata: Prisma.JsonValue }>;
};

/**
 * Assemble a complete, machine-readable copy of everything we hold about the
 * caller. Satisfies GDPR Art 15 (access) + Art 20 (portability), Australia
 * APP 12, DPDP §11, and the various PDPA access rights at once.
 */
export async function buildUserDataExport(ctx: OrgContext): Promise<UserDataExport> {
  const db = withOrg(ctx);

  const user = await db.user.findUnique({
    where: { id: ctx.user_id },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      ielts_track: true,
      age_assurance: true,
      createdAt: true,
      org: { select: { id: true, name: true } },
    },
  });
  if (!user) {
    throw new Error("Data export requested for a user not in the caller's org.");
  }

  const [consents, requests, attempts, activity] = await Promise.all([
    db.consentRecord.findMany({
      where: { user_id: ctx.user_id },
      orderBy: { createdAt: "desc" },
      select: {
        consent_type: true,
        granted: true,
        policy_version: true,
        source: true,
        createdAt: true,
      },
    }),
    db.dataRightsRequest.findMany({
      where: { user_id: ctx.user_id },
      orderBy: { requested_at: "desc" },
      select: { type: true, status: true, requested_at: true, fulfilled_at: true },
    }),
    db.attempt.findMany({
      where: { user_id: ctx.user_id },
      orderBy: { started_at: "desc" },
      select: {
        id: true,
        section: true,
        status: true,
        started_at: true,
        submitted_at: true,
        grade: {
          select: {
            band_overall: true,
            criteria_scores_json: true,
            feedback_text: true,
          },
        },
        answers: {
          select: { question_id: true, response: true, is_correct: true },
        },
        recording: { select: { duration_sec: true, createdAt: true } },
      },
    }),
    db.activityLog.findMany({
      where: { user_id: ctx.user_id },
      orderBy: { timestamp: "desc" },
      select: { action: true, timestamp: true, metadata: true },
    }),
  ]);

  return {
    generated_at: new Date().toISOString(),
    subject: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      ielts_track: user.ielts_track,
      age_assurance: user.age_assurance,
      created_at: user.createdAt.toISOString(),
    },
    organization: { id: user.org.id, name: user.org.name },
    consents: consents.map((c) => ({
      consent_type: c.consent_type,
      granted: c.granted,
      policy_version: c.policy_version,
      source: c.source,
      recorded_at: c.createdAt.toISOString(),
    })),
    data_rights_requests: requests.map((r) => ({
      type: r.type,
      status: r.status,
      requested_at: r.requested_at.toISOString(),
      fulfilled_at: r.fulfilled_at ? r.fulfilled_at.toISOString() : null,
    })),
    attempts: attempts.map((a) => ({
      id: a.id,
      section: a.section,
      status: a.status,
      started_at: a.started_at.toISOString(),
      submitted_at: a.submitted_at ? a.submitted_at.toISOString() : null,
      grade: a.grade
        ? {
            band_overall: a.grade.band_overall.toString(),
            criteria_scores: a.grade.criteria_scores_json,
            feedback_text: a.grade.feedback_text,
          }
        : null,
      answers: a.answers.map((ans) => ({
        question_id: ans.question_id,
        response: ans.response,
        is_correct: ans.is_correct,
      })),
      recording: a.recording
        ? { duration_sec: a.recording.duration_sec, created_at: a.recording.createdAt.toISOString() }
        : null,
    })),
    activity_log: activity.map((l) => ({
      action: l.action,
      timestamp: l.timestamp.toISOString(),
      metadata: l.metadata ?? null,
    })),
  };
}

// ─── Requests ───────────────────────────────────────────────────────────

/** Record that the caller exercised a data-subject right. */
export async function createDataRightsRequest(
  ctx: OrgContext,
  input: { type: DataRightType; detail?: string | null },
): Promise<{ id: string }> {
  const db = withOrg(ctx);
  const [row] = await db.$transaction([
    db.dataRightsRequest.create({
      data: {
        org_id: ctx.org_id,
        user_id: ctx.user_id,
        type: input.type,
        detail: input.detail ?? null,
      },
      select: { id: true },
    }),
    db.activityLog.create({
      data: {
        org_id: ctx.org_id,
        user_id: ctx.user_id,
        action: `data_rights.${input.type.toLowerCase()}_requested`,
        metadata: { detail: input.detail ?? null } as Prisma.InputJsonValue,
      },
    }),
  ]);
  return row;
}

export async function listMyDataRightsRequests(ctx: OrgContext) {
  const db = withOrg(ctx);
  return db.dataRightsRequest.findMany({
    where: { user_id: ctx.user_id },
    orderBy: { requested_at: "desc" },
    select: {
      id: true,
      type: true,
      status: true,
      detail: true,
      requested_at: true,
      fulfilled_at: true,
    },
  });
}

/**
 * Queue an erasure ("right to be forgotten"). Idempotent: if the caller
 * already has a Pending erasure, returns it rather than stacking duplicates.
 * The PII scrub itself happens in retention.ts after the cancellation window.
 */
export async function requestErasure(
  ctx: OrgContext,
  input?: { detail?: string | null },
): Promise<{ id: string; alreadyPending: boolean }> {
  const db = withOrg(ctx);
  const existing = await db.dataRightsRequest.findFirst({
    where: { user_id: ctx.user_id, type: "Erasure", status: "Pending" },
    select: { id: true },
  });
  if (existing) return { id: existing.id, alreadyPending: true };
  const created = await createDataRightsRequest(ctx, {
    type: "Erasure",
    detail: input?.detail ?? null,
  });
  return { id: created.id, alreadyPending: false };
}

/** Let the caller cancel a still-Pending erasure before the purge runs. */
export async function cancelErasure(ctx: OrgContext): Promise<number> {
  const db = withOrg(ctx);
  const res = await db.dataRightsRequest.updateMany({
    where: { user_id: ctx.user_id, type: "Erasure", status: "Pending" },
    data: { status: "Cancelled" },
  });
  return res.count;
}

// ─── Rectification + minors ───────────────────────────────────────────────

/** Correct the caller's display name (GDPR Art 16 / APP 13). */
export async function rectifyMyName(
  ctx: OrgContext,
  name: string,
): Promise<{ ok: boolean }> {
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > 120) return { ok: false };
  const db = withOrg(ctx);
  await db.$transaction([
    db.user.update({ where: { id: ctx.user_id }, data: { name: trimmed } }),
    db.activityLog.create({
      data: {
        org_id: ctx.org_id,
        user_id: ctx.user_id,
        action: "data_rights.rectification_self",
        metadata: { field: "name" } as Prisma.InputJsonValue,
      },
    }),
  ]);
  return { ok: true };
}

/**
 * Record a learner's coarse age band (we never store full DOB). When Minor,
 * a guardian email + guardian consent timestamp are required downstream
 * before practice access — enforced at the app layer. See ADR-0019 D3.
 */
export async function setAgeAssurance(
  ctx: OrgContext,
  input: { age_assurance: Exclude<AgeAssurance, "Unknown">; guardian_email?: string | null },
): Promise<void> {
  const db = withOrg(ctx);
  await db.user.update({
    where: { id: ctx.user_id },
    data: {
      age_assurance: input.age_assurance,
      guardian_email:
        input.age_assurance === "Minor" ? (input.guardian_email ?? null) : null,
    },
  });
}

export async function recordGuardianConsent(ctx: OrgContext): Promise<void> {
  const db = withOrg(ctx);
  await db.user.update({
    where: { id: ctx.user_id },
    data: { guardian_consent_at: new Date() },
  });
}
