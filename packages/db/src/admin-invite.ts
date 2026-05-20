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

import { Prisma } from "@prisma/client";
import { prisma } from "./client";
import { withOrg, type OrgContext } from "./tenancy";

export const CSV_ROW_CAP = 500;

export type InviteFailureReason =
  | "seat_limit_reached"
  | "cannot_invite"
  | "invalid_email";

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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
): Promise<InviteResult> {
  const email = normalizeEmail(input.email);
  if (!email) return { ok: false, reason: "invalid_email" };
  const name = normalizeName(input.name);

  // Intentional cross-org lookup. Never expose the foreign org_id upward.
  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true, org_id: true },
  });
  if (existing && existing.org_id !== ctx.org_id) {
    return { ok: false, reason: "cannot_invite" };
  }
  if (existing && existing.org_id === ctx.org_id) {
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
): Promise<CsvInviteResult> {
  const { rows, truncatedAt } = parseInviteCsv(text);
  let invited = 0;
  let skipped = 0;
  const failed: CsvRowResult[] = [];

  for (const row of rows) {
    const res = await inviteLearnerForOrg(ctx, {
      email: row.email,
      name: row.name,
    });
    if (res.ok) {
      if (res.alreadyExisted) skipped += 1;
      else invited += 1;
    } else {
      failed.push({ row: row.row, email: row.email, reason: res.reason });
    }
  }

  return { invited, skipped, failed, truncatedAt };
}
