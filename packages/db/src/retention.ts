// Data retention + erasure execution (ADR-0019).
//
// These are SYSTEM-level maintenance jobs, not request handlers. Like the
// seed and the Clerk/Stripe webhooks, they use the raw `prisma` client
// directly and iterate orgs explicitly — they are NOT request-scoped, so
// neither withOrg() nor withSuperAdminContext() applies (and the "never use
// both in one function" rule is moot here: this function uses neither). The
// only entry points are the authenticated cron route in apps/web. See
// .claude/rules/multi-tenancy.md "SuperAdmin is the only exception" + ADR-0019.
//
// Two responsibilities:
//   1. purgeExpiredRecordings — delete Speaking audio past the retention
//      window (default 90 days), closing the long-open CLAUDE.md question.
//   2. processPendingErasures — action queued "right to be forgotten"
//      requests once their cancellation grace period has elapsed.
//
// Both take a `deleteObject` callback so the DB package never imports the R2
// storage client (keeps the dependency direction clean); the web cron route
// wires @elc/storage in.

import { prisma } from "./client";

/** Default Speaking-audio retention. Per-org override is a documented follow-up. */
export const DEFAULT_RECORDING_RETENTION_DAYS = 90;

/** How long a Pending erasure can be cancelled before the purge actions it. */
export const ERASURE_GRACE_PERIOD_HOURS = 24;

export type DeleteObjectFn = (storageUrl: string) => Promise<void>;

export type PurgeRecordingsResult = {
  scanned: number;
  deleted: number;
  storageErrors: number;
};

/**
 * Delete Recording rows (and their R2 objects) older than the retention
 * window. Idempotent — re-running only ever targets rows still past the
 * cutoff. Storage deletion failures are counted but do not block the DB
 * delete: a dangling object is a smaller problem than retained voice data.
 */
export async function purgeExpiredRecordings(opts: {
  now?: Date;
  retentionDays?: number;
  deleteObject?: DeleteObjectFn;
}): Promise<PurgeRecordingsResult> {
  const now = opts.now ?? new Date();
  const retentionDays = opts.retentionDays ?? DEFAULT_RECORDING_RETENTION_DAYS;
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);

  const expired = await prisma.recording.findMany({
    where: { createdAt: { lt: cutoff } },
    select: { id: true, storage_url: true },
  });

  let storageErrors = 0;
  if (opts.deleteObject) {
    for (const rec of expired) {
      try {
        await opts.deleteObject(rec.storage_url);
      } catch {
        storageErrors += 1;
      }
    }
  }

  let deleted = 0;
  if (expired.length > 0) {
    const res = await prisma.recording.deleteMany({
      where: { id: { in: expired.map((r) => r.id) } },
    });
    deleted = res.count;
  }

  return { scanned: expired.length, deleted, storageErrors };
}

export type ErasureResult = {
  processed: number;
  recordingsDeleted: number;
  storageErrors: number;
};

/**
 * Action Pending erasure requests whose grace period has elapsed. For each
 * subject we:
 *   1. delete their Speaking recordings from storage (voice = sensitive),
 *   2. delete attempts (cascades answers/grades/recordings), mock sessions,
 *      quota usage, and the consent ledger,
 *   3. scrub the User row to an unidentifiable tombstone (keeps a row so we
 *      can prove the erasure, but holds no PII),
 *   4. mark the request Completed.
 * The DataRightsRequest row + an ActivityLog entry survive as the audit
 * trail that the erasure was carried out.
 */
export async function processPendingErasures(opts: {
  now?: Date;
  gracePeriodHours?: number;
  deleteObject?: DeleteObjectFn;
}): Promise<ErasureResult> {
  const now = opts.now ?? new Date();
  const graceHours = opts.gracePeriodHours ?? ERASURE_GRACE_PERIOD_HOURS;
  const cutoff = new Date(now.getTime() - graceHours * 60 * 60 * 1000);

  const due = await prisma.dataRightsRequest.findMany({
    where: { type: "Erasure", status: "Pending", requested_at: { lt: cutoff } },
    select: { id: true, org_id: true, user_id: true },
  });

  let recordingsDeleted = 0;
  let storageErrors = 0;

  for (const req of due) {
    // 1. Delete voice recordings from storage first (outside the txn).
    const recordings = await prisma.recording.findMany({
      where: { org_id: req.org_id, attempt: { user_id: req.user_id } },
      select: { storage_url: true },
    });
    if (opts.deleteObject) {
      for (const rec of recordings) {
        try {
          await opts.deleteObject(rec.storage_url);
        } catch {
          storageErrors += 1;
        }
      }
    }
    recordingsDeleted += recordings.length;

    // 2-4. Scrub + delete in one transaction.
    const tombstoneEmail = `erased+${req.user_id}@deleted.invalid`;
    await prisma.$transaction([
      // Deleting attempts cascades to answers, grades, and recordings.
      prisma.attempt.deleteMany({ where: { org_id: req.org_id, user_id: req.user_id } }),
      prisma.mockSession.deleteMany({ where: { org_id: req.org_id, user_id: req.user_id } }),
      prisma.quotaUsage.deleteMany({ where: { org_id: req.org_id, user_id: req.user_id } }),
      prisma.consentRecord.deleteMany({ where: { org_id: req.org_id, user_id: req.user_id } }),
      prisma.user.update({
        where: { id: req.user_id },
        data: {
          email: tombstoneEmail,
          name: null,
          clerk_user_id: null,
          guardian_email: null,
          age_assurance: "Unknown",
          erased_at: now,
          deleted_at: now,
        },
      }),
      prisma.dataRightsRequest.update({
        where: { id: req.id },
        data: { status: "Completed", fulfilled_at: now },
      }),
      prisma.activityLog.create({
        data: {
          org_id: req.org_id,
          user_id: req.user_id,
          action: "data_rights.erasure_completed",
          metadata: { request_id: req.id },
        },
      }),
    ]);
  }

  return { processed: due.length, recordingsDeleted, storageErrors };
}
