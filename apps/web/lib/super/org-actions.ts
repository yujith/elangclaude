"use server";

// SuperAdmin-only server actions for organisation CRUD.
//
// Organization is a global (non-tenant-scoped) model, so we read/write it
// via the unextended PrismaClient that withSuperAdminContext() returns.
// ActivityLog rows for super-level events go under SYSTEM_ORG_ID — never
// under the SuperAdmin's home org — so OrgAdmin views (which filter by
// their own org_id via withOrg()) never see super-level events.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  Prisma,
  SYSTEM_ORG_ID,
  withSuperAdminContext,
  type OrgStatus,
} from "@elc/db";
import { requireRole } from "@/lib/auth/context";

const NAME_MAX = 200;
// Generous ceiling — well above any realistic enterprise customer, low
// enough that a fat-finger typo doesn't produce a billion-seat org row.
const SEAT_LIMIT_MAX = 100_000;
const QUOTA_DAILY_MAX = 1_000_000;
const QUOTA_MONTHLY_MAX = 30_000_000;

export type OrgFormFailureReason =
  | "name_required"
  | "name_too_long"
  | "seat_limit_invalid"
  | "quota_daily_invalid"
  | "quota_monthly_invalid"
  | "invalid_status"
  | "system_org_immutable"
  | "not_found";

export type OrgInput = {
  name: string;
  seat_limit: number;
  quota_daily: number;
  quota_monthly: number;
};

export type CreateOrgResult =
  | { ok: true; org_id: string }
  | { ok: false; reason: OrgFormFailureReason };

export type UpdateOrgResult =
  | { ok: true }
  | { ok: false; reason: OrgFormFailureReason };

const VALID_STATUSES: ReadonlySet<OrgStatus> = new Set([
  "Active",
  "Suspended",
  "Archived",
]);

function normalizeName(raw: unknown): {
  ok: true;
  value: string;
} | {
  ok: false;
  reason: "name_required" | "name_too_long";
} {
  if (typeof raw !== "string") return { ok: false, reason: "name_required" };
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: false, reason: "name_required" };
  if (trimmed.length > NAME_MAX) return { ok: false, reason: "name_too_long" };
  return { ok: true, value: trimmed };
}

function parseNonNegativeInt(
  raw: unknown,
  max: number,
): number | null {
  const n =
    typeof raw === "string"
      ? Number.parseInt(raw, 10)
      : typeof raw === "number"
        ? raw
        : Number.NaN;
  if (!Number.isInteger(n) || n < 0 || n > max) return null;
  return n;
}

function parseOrgInput(input: {
  name: unknown;
  seat_limit: unknown;
  quota_daily: unknown;
  quota_monthly: unknown;
}):
  | { ok: true; value: OrgInput }
  | { ok: false; reason: OrgFormFailureReason } {
  const nameResult = normalizeName(input.name);
  if (!nameResult.ok) return { ok: false, reason: nameResult.reason };

  const seat = parseNonNegativeInt(input.seat_limit, SEAT_LIMIT_MAX);
  if (seat === null) return { ok: false, reason: "seat_limit_invalid" };

  const daily = parseNonNegativeInt(input.quota_daily, QUOTA_DAILY_MAX);
  if (daily === null) return { ok: false, reason: "quota_daily_invalid" };

  const monthly = parseNonNegativeInt(input.quota_monthly, QUOTA_MONTHLY_MAX);
  if (monthly === null) {
    return { ok: false, reason: "quota_monthly_invalid" };
  }

  return {
    ok: true,
    value: {
      name: nameResult.value,
      seat_limit: seat,
      quota_daily: daily,
      quota_monthly: monthly,
    },
  };
}

// ─── Programmatic entries (testable without booting Next) ─────────────────

export async function createOrg(input: {
  name: unknown;
  seat_limit: unknown;
  quota_daily: unknown;
  quota_monthly: unknown;
}): Promise<CreateOrgResult> {
  const ctx = await requireRole("SuperAdmin");
  const parsed = parseOrgInput(input);
  if (!parsed.ok) return parsed;
  const db = withSuperAdminContext(ctx);

  const created = await db.organization.create({
    data: { ...parsed.value },
    select: { id: true },
  });
  await db.activityLog.create({
    data: {
      org_id: SYSTEM_ORG_ID,
      user_id: ctx.user_id,
      action: "super.org.created",
      metadata: {
        org_id: created.id,
        name: parsed.value.name,
        seat_limit: parsed.value.seat_limit,
        quota_daily: parsed.value.quota_daily,
        quota_monthly: parsed.value.quota_monthly,
      } as Prisma.InputJsonValue,
    },
  });
  return { ok: true, org_id: created.id };
}

export async function updateOrgSettings(input: {
  org_id: unknown;
  name: unknown;
  seat_limit: unknown;
  quota_daily: unknown;
  quota_monthly: unknown;
}): Promise<UpdateOrgResult> {
  const ctx = await requireRole("SuperAdmin");
  if (typeof input.org_id !== "string" || input.org_id.length === 0) {
    return { ok: false, reason: "not_found" };
  }
  if (input.org_id === SYSTEM_ORG_ID) {
    return { ok: false, reason: "system_org_immutable" };
  }
  const parsed = parseOrgInput(input);
  if (!parsed.ok) return parsed;
  const db = withSuperAdminContext(ctx);

  const existing = await db.organization.findUnique({
    where: { id: input.org_id },
    select: {
      name: true,
      seat_limit: true,
      quota_daily: true,
      quota_monthly: true,
    },
  });
  if (!existing) return { ok: false, reason: "not_found" };

  await db.organization.update({
    where: { id: input.org_id },
    data: { ...parsed.value },
  });
  await db.activityLog.create({
    data: {
      org_id: SYSTEM_ORG_ID,
      user_id: ctx.user_id,
      action: "super.org.updated",
      metadata: {
        org_id: input.org_id,
        before: existing,
        after: parsed.value,
      } as Prisma.InputJsonValue,
    },
  });
  return { ok: true };
}

export async function setOrgStatus(input: {
  org_id: unknown;
  status: unknown;
}): Promise<UpdateOrgResult> {
  const ctx = await requireRole("SuperAdmin");
  if (typeof input.org_id !== "string" || input.org_id.length === 0) {
    return { ok: false, reason: "not_found" };
  }
  if (input.org_id === SYSTEM_ORG_ID) {
    return { ok: false, reason: "system_org_immutable" };
  }
  if (
    typeof input.status !== "string" ||
    !VALID_STATUSES.has(input.status as OrgStatus)
  ) {
    return { ok: false, reason: "invalid_status" };
  }
  const status = input.status as OrgStatus;
  const db = withSuperAdminContext(ctx);

  const existing = await db.organization.findUnique({
    where: { id: input.org_id },
    select: { status: true },
  });
  if (!existing) return { ok: false, reason: "not_found" };
  if (existing.status === status) {
    // No-op — keep the log clean.
    return { ok: true };
  }

  await db.organization.update({
    where: { id: input.org_id },
    data: { status },
  });
  await db.activityLog.create({
    data: {
      org_id: SYSTEM_ORG_ID,
      user_id: ctx.user_id,
      action: "super.org.status_changed",
      metadata: {
        org_id: input.org_id,
        before: existing.status,
        after: status,
      } as Prisma.InputJsonValue,
    },
  });
  return { ok: true };
}

// ─── Form-action wrappers ────────────────────────────────────────────────

export async function createOrgFromForm(formData: FormData): Promise<void> {
  const result = await createOrg({
    name: formData.get("name"),
    seat_limit: formData.get("seat_limit"),
    quota_daily: formData.get("quota_daily"),
    quota_monthly: formData.get("quota_monthly"),
  });
  if (!result.ok) {
    redirect(`/orgs/new?error=${result.reason}`);
  }
  revalidatePath("/orgs");
  redirect(`/orgs/${result.org_id}?created=1`);
}

export async function updateOrgSettingsFromForm(
  formData: FormData,
): Promise<void> {
  const orgIdRaw = formData.get("org_id");
  const orgId =
    typeof orgIdRaw === "string" && orgIdRaw.length > 0 ? orgIdRaw : null;
  const result = await updateOrgSettings({
    org_id: orgIdRaw,
    name: formData.get("name"),
    seat_limit: formData.get("seat_limit"),
    quota_daily: formData.get("quota_daily"),
    quota_monthly: formData.get("quota_monthly"),
  });
  if (!result.ok) {
    if (orgId) redirect(`/orgs/${orgId}?error=${result.reason}`);
    redirect(`/orgs?error=${result.reason}`);
  }
  revalidatePath("/orgs");
  if (orgId) revalidatePath(`/orgs/${orgId}`);
  redirect(`/orgs/${orgId}?saved=1`);
}

export async function setOrgStatusFromForm(formData: FormData): Promise<void> {
  const orgIdRaw = formData.get("org_id");
  const orgId =
    typeof orgIdRaw === "string" && orgIdRaw.length > 0 ? orgIdRaw : null;
  const result = await setOrgStatus({
    org_id: orgIdRaw,
    status: formData.get("status"),
  });
  if (!result.ok) {
    if (orgId) redirect(`/orgs/${orgId}?error=${result.reason}`);
    redirect(`/orgs?error=${result.reason}`);
  }
  revalidatePath("/orgs");
  if (orgId) revalidatePath(`/orgs/${orgId}`);
  redirect(`/orgs/${orgId}?status_changed=1`);
}
