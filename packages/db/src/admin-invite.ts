// OrgAdmin invite — pure DB-touching logic. The Next server action in
// apps/web/lib/admin/invite-actions.ts is a thin wrapper that runs
// requireRole("OrgAdmin") and forwards to these functions. Keeping
// the logic here means the seat-limit, cross-org, and idempotency
// rules are testable in vitest without booting Next.
//
// All writes go through withOrg(ctx); the one prisma.user.findUnique
// by email is an intentional cross-org check (we must know whether
// the email exists anywhere on the platform so we can refuse without
// leaking which org owns it).
//
// Phase 2 (Clerk invitations): after a fresh DB row is created, we
// call Clerk's invitations API so the invitee receives the sign-in
// email. The Clerk call is the second half of the invite; a hard
// Clerk failure rolls the DB row back so the next attempt starts
// clean. CLERK_SECRET_KEY and APP_URL are required envs for any
// caller that doesn't inject a stub client.

import { createClerkClient } from "@clerk/backend";
import { isClerkAPIResponseError } from "@clerk/backend/errors";
import { Prisma } from "@prisma/client";
import { prisma } from "./client";
import { withOrg, type OrgContext } from "./tenancy";

export const CSV_ROW_CAP = 500;

export type InviteFailureReason =
  | "seat_limit_reached"
  | "cannot_invite"
  | "invalid_email"
  | "clerk_rate_limited";

export type InviteResult =
  | { ok: true; user_id: string; alreadyExisted: boolean }
  | { ok: false; reason: InviteFailureReason };

export type CsvRowResult = {
  row: number;
  email: string;
  reason: InviteFailureReason;
};

export type CsvInviteResult = {
  invited: number;
  skipped: number;
  failed: CsvRowResult[];
  truncatedAt: number | null;
};

export type ParsedCsvRow = {
  row: number;
  email: string;
  name: string | null;
};

/**
 * The minimal Clerk surface area the invite path uses. Tests pass a stub;
 * production wraps `createClerkClient` from `@clerk/backend`. Kept here
 * (rather than imported from `@clerk/backend`) so `vi.mock` ESM gymnastics
 * stay out of admin-invite.test.ts — same pattern as clerk-seed.ts.
 */
export interface InviteClerkClient {
  invitations: {
    createInvitation(params: {
      emailAddress: string;
      redirectUrl?: string;
      publicMetadata?: Record<string, unknown>;
    }): Promise<{ id: string }>;
  };
}

export interface InviteOptions {
  /** Inject a stub for tests. If omitted, a real client is built from
   *  CLERK_SECRET_KEY at first call (throws if the env is unset). */
  clerkClient?: InviteClerkClient;
  /** Defaults to `process.env.APP_URL`. Throws at invite time if both
   *  this and the env var are missing. */
  appUrl?: string;
  /** For tests — replace setTimeout so the 429-retry path is instant. */
  sleep?: (ms: number) => Promise<void>;
}

export class InviteEnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InviteEnvError";
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CLERK_RETRY_DELAY_MS = 2000;

function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().toLowerCase();
  if (!EMAIL_RE.test(trimmed)) return null;
  return trimmed;
}

function normalizeName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed.slice(0, 200);
}

export function parseInviteCsv(text: string): {
  rows: ParsedCsvRow[];
  truncatedAt: number | null;
} {
  const lines = text.split(/\r?\n/);
  const rows: ParsedCsvRow[] = [];
  let truncatedAt: number | null = null;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]?.trim();
    if (!raw) continue;
    if (i === 0 && /^email(\s*,)?/i.test(raw)) continue;
    if (rows.length >= CSV_ROW_CAP) {
      truncatedAt = i + 1;
      break;
    }
    const [emailCell, ...rest] = raw.split(",");
    const email = (emailCell ?? "").trim();
    const name = rest.join(",").trim();
    rows.push({ row: i + 1, email, name: name.length ? name : null });
  }
  return { rows, truncatedAt };
}

export async function inviteLearnerForOrg(
  ctx: OrgContext,
  input: { email: string; name?: string | null },
  options: InviteOptions = {},
): Promise<InviteResult> {
  const email = normalizeEmail(input.email);
  if (!email) return { ok: false, reason: "invalid_email" };
  const name = normalizeName(input.name);

  // Intentional cross-org lookup. Never expose the foreign org_id upward.
  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true, org_id: true, role: true, deleted_at: true },
  });
  if (existing && existing.org_id !== ctx.org_id) {
    return { ok: false, reason: "cannot_invite" };
  }
  if (existing && existing.deleted_at !== null) {
    // Same org, but soft-deleted. Refuse so "remove" stays final until
    // a deliberate restore flow exists — auto-undeleting on re-invite
    // would surprise an admin who removed someone yesterday.
    return { ok: false, reason: "cannot_invite" };
  }
  if (existing && existing.org_id === ctx.org_id) {
    if (existing.role !== "Learner") {
      return { ok: false, reason: "cannot_invite" };
    }
    return { ok: true, user_id: existing.id, alreadyExisted: true };
  }

  const result = await prisma.$transaction(async (tx) => {
    const org = await tx.organization.findUnique({
      where: { id: ctx.org_id },
      select: { seat_limit: true },
    });
    if (!org) return { kind: "fail" as const, reason: "cannot_invite" as const };

    const learnerCount = await tx.user.count({
      where: { org_id: ctx.org_id, role: "Learner" },
    });
    if (learnerCount >= org.seat_limit) {
      return { kind: "fail" as const, reason: "seat_limit_reached" as const };
    }

    const user = await tx.user.create({
      data: {
        org_id: ctx.org_id,
        email,
        name,
        role: "Learner",
        ielts_track: "Academic",
      },
      select: { id: true },
    });
    return { kind: "ok" as const, user_id: user.id };
  });

  if (result.kind === "fail") return { ok: false, reason: result.reason };

  // The DB row exists; now hand the email to Clerk. On hard failure
  // (5xx or unrecoverable 429), undo the DB row so the next attempt
  // starts from a clean slate — an unsent invitation must not leave
  // an orphan Learner row visible in the admin UI.
  const inviteResult = await sendLearnerInvitation(ctx, email, options);
  if (inviteResult.kind === "fail") {
    await prisma.user.delete({ where: { id: result.user_id } });
    return { ok: false, reason: inviteResult.reason };
  }

  await withOrg(ctx).activityLog.create({
    data: {
      org_id: ctx.org_id,
      user_id: ctx.user_id,
      action: "learner.invited",
      metadata: {
        invited_email: email,
        invited_user_id: result.user_id,
      } as Prisma.InputJsonValue,
    },
  });

  return { ok: true, user_id: result.user_id, alreadyExisted: false };
}

export async function inviteLearnersFromCsvForOrg(
  ctx: OrgContext,
  text: string,
  options: InviteOptions = {},
): Promise<CsvInviteResult> {
  const { rows, truncatedAt } = parseInviteCsv(text);
  let invited = 0;
  let skipped = 0;
  const failed: CsvRowResult[] = [];

  for (const row of rows) {
    const res = await inviteLearnerForOrg(
      ctx,
      { email: row.email, name: row.name },
      options,
    );
    if (res.ok) {
      if (res.alreadyExisted) skipped += 1;
      else invited += 1;
    } else {
      failed.push({ row: row.row, email: row.email, reason: res.reason });
    }
  }

  return { invited, skipped, failed, truncatedAt };
}

// ─── Clerk side ─────────────────────────────────────────────────────────

type SendInviteResult =
  | { kind: "ok" }
  | { kind: "fail"; reason: "cannot_invite" | "clerk_rate_limited" };

async function sendLearnerInvitation(
  ctx: OrgContext,
  email: string,
  options: InviteOptions,
): Promise<SendInviteResult> {
  const appUrl = options.appUrl ?? process.env.APP_URL;
  if (!appUrl) {
    throw new InviteEnvError(
      "APP_URL must be set to send Clerk invitations. " +
        "Add APP_URL=http://localhost:3000 to apps/web/.env.local for dev, " +
        "or the public site URL for production.",
    );
  }

  const client = options.clerkClient ?? buildClerkClient();
  const sleep = options.sleep ?? defaultSleep;

  // Clerk's invitation flow lands the invitee here after the ticket is
  // verified. It MUST be /sign-up (not /post-signin) so the <SignUp>
  // component can read `__clerk_ticket` from the query string and bind
  // the new Clerk account to the invitation. /sign-up's own
  // fallbackRedirectUrl then sends the freshly-signed-up user on to
  // /post-signin for role routing — same final destination either way.
  const params = {
    emailAddress: email,
    redirectUrl: `${appUrl}/sign-up`,
    publicMetadata: { org_id: ctx.org_id, role: "Learner" },
  };

  // Two attempts: one fresh, one after a 2s backoff on 429. A second 429
  // surfaces as `clerk_rate_limited` so the admin sees an actionable
  // message rather than a hidden retry loop.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await client.invitations.createInvitation(params);
      return { kind: "ok" };
    } catch (err) {
      if (isDuplicateInvitation(err)) {
        // Clerk already has an invite (or an account) for this email.
        // The DB row is in place; treat as success so the admin's
        // "re-invite" UX is idempotent.
        return { kind: "ok" };
      }
      if (isRateLimited(err)) {
        if (attempt === 0) {
          await sleep(CLERK_RETRY_DELAY_MS);
          continue;
        }
        return { kind: "fail", reason: "clerk_rate_limited" };
      }
      if (isServerError(err)) {
        return { kind: "fail", reason: "cannot_invite" };
      }
      // 4xx other than 422-duplicate / 429 is a real bug — config error,
      // bad input we didn't catch, etc. Surface it so the admin sees a
      // 500 and we get a Sentry hit instead of a silent failure.
      throw err;
    }
  }

  // Unreachable — the loop either returns or throws.
  return { kind: "fail", reason: "cannot_invite" };
}

function buildClerkClient(): InviteClerkClient {
  if (!process.env.CLERK_SECRET_KEY) {
    throw new InviteEnvError(
      "CLERK_SECRET_KEY must be set to send Clerk invitations. " +
        "Pass options.clerkClient in tests, or set the env var in " +
        "apps/web/.env.local (dev) / Vercel project settings (prod).",
    );
  }
  return createClerkClient({
    secretKey: process.env.CLERK_SECRET_KEY,
  }) as unknown as InviteClerkClient;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isDuplicateInvitation(err: unknown): boolean {
  if (!isClerkAPIResponseError(err)) return false;
  return err.errors.some(
    (e: { code: string }) => e.code === "duplicate_record",
  );
}

function isRateLimited(err: unknown): boolean {
  if (!isClerkAPIResponseError(err)) return false;
  return err.status === 429;
}

function isServerError(err: unknown): boolean {
  if (!isClerkAPIResponseError(err)) return false;
  return err.status >= 500 && err.status < 600;
}
