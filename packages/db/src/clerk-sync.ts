// Pure DB-touching logic for the Clerk webhook. The Next route handler
// in apps/web/app/api/clerk/webhook/route.ts verifies the Svix signature
// and dispatches; everything below is testable in vitest without booting
// Next or running ngrok.
//
// All functions are idempotent: each path either upserts by a unique key
// (clerk_user_id, clerk_org_id, email) or no-ops gracefully when state is
// already correct. Re-delivery from Clerk is therefore safe.

import { Prisma } from "@prisma/client";
import { prisma } from "./client";
import type { Role } from "@prisma/client";

// Sane defaults for an org created via Clerk before SuperAdmin tunes them.
// Mirrors the order seed-time pattern: small free-tier feel that the
// SuperAdmin console then raises. Keep these conservative — they cap
// spend if an org gets created and forgotten.
export const CLERK_NEW_ORG_DEFAULTS = {
  seat_limit: 10,
  quota_daily: 50,
  quota_monthly: 1000,
} as const;

// ─── Event payload types (mirror Clerk's webhook shapes) ────────────────

export type ClerkEmailAddress = { id: string; email_address: string };

export type ClerkUserPayload = {
  id: string;
  primary_email_address_id: string | null;
  email_addresses: ClerkEmailAddress[];
  first_name: string | null;
  last_name: string | null;
};

export type ClerkOrgPayload = {
  id: string;
  name: string;
};

export type ClerkMembershipPayload = {
  id: string;
  role: string;
  organization: ClerkOrgPayload;
  public_user_data: {
    user_id: string;
    identifier: string;
    first_name: string | null;
    last_name: string | null;
  };
};

// ─── User events ────────────────────────────────────────────────────────

export async function applyClerkUserUpsert(
  data: ClerkUserPayload,
): Promise<void> {
  const email = pickPrimaryEmail(data);
  if (!email) return;
  const name = joinName(data.first_name, data.last_name);

  // Already linked? Update all matching rows' mutable fields.
  const linked = await prisma.user.count({
    where: { clerk_user_id: data.id },
  });
  if (linked > 0) {
    await prisma.user.updateMany({
      where: { clerk_user_id: data.id },
      data: { email, name },
    });
    return;
  }

  // Pre-existing seeded rows with the same email (across orgs)? Link them all.
  const byEmail = await prisma.user.count({
    where: { email },
  });
  if (byEmail > 0) {
    await prisma.user.updateMany({
      where: { email },
      data: { clerk_user_id: data.id, name },
    });
    return;
  }

  // Otherwise no-op — we wait for organizationMembership.created to
  // tell us which org this user belongs to before creating a row.
}

export async function applyClerkUserDeleted(clerkUserId: string): Promise<void> {
  // Soft-delete keeps the audit trail intact (attempts/grades/recordings
  // stay attached). Matches the existing SuperAdmin "remove user" flow.
  // With multi-org, soft-delete all rows for this Clerk user across all orgs.
  await prisma.user.updateMany({
    where: { clerk_user_id: clerkUserId, deleted_at: null },
    data: { deleted_at: new Date() },
  });
}

// ─── Organization events ────────────────────────────────────────────────

export async function applyClerkOrgUpsert(data: ClerkOrgPayload): Promise<void> {
  const existing = await prisma.organization.findUnique({
    where: { clerk_org_id: data.id },
    select: { id: true },
  });
  if (existing) {
    await prisma.organization.update({
      where: { id: existing.id },
      data: { name: data.name },
    });
    return;
  }
  await prisma.organization.create({
    data: {
      clerk_org_id: data.id,
      name: data.name,
      ...CLERK_NEW_ORG_DEFAULTS,
      status: "Active",
    },
  });
}

export async function applyClerkOrgDeleted(clerkOrgId: string): Promise<void> {
  // Archive rather than hard-delete: preserves Attempt/Recording history
  // and keeps the row visible in the SuperAdmin console for audit.
  const existing = await prisma.organization.findUnique({
    where: { clerk_org_id: clerkOrgId },
    select: { id: true },
  });
  if (!existing) return;
  await prisma.organization.update({
    where: { id: existing.id },
    data: { status: "Archived" },
  });
}

// ─── Membership events ──────────────────────────────────────────────────

export async function applyClerkMembershipUpsert(
  data: ClerkMembershipPayload,
): Promise<void> {
  const clerkRole = mapClerkRole(data.role);
  const org = await ensureOrg(data.organization);
  const user = await ensureUser({
    clerkUserId: data.public_user_data.user_id,
    email: data.public_user_data.identifier,
    name: joinName(
      data.public_user_data.first_name,
      data.public_user_data.last_name,
    ),
    org_id: org.id,
  });

  // SuperAdmin is DB-controlled (see CLAUDE.md). The webhook must never
  // demote a SuperAdmin via a membership event — otherwise the very act
  // of a SuperAdmin joining a Clerk org would silently strip their
  // cross-org powers.
  const currentRole = await prisma.user.findUnique({
    where: { id: user.id },
    select: { role: true },
  });
  const role = currentRole?.role === "SuperAdmin" ? "SuperAdmin" : clerkRole;

  await prisma.user.update({
    where: { id: user.id },
    data: {
      // Membership transferred from another org (rare but possible if a
      // user is removed from org A and added to org B).
      org_id: org.id,
      role,
      // Re-activate a previously removed member if Clerk says they're
      // back in the org.
      deleted_at: null,
    },
  });
}

export async function applyClerkMembershipDeleted(
  data: ClerkMembershipPayload,
): Promise<void> {
  // Soft-delete only the user row in the specific org that membership was deleted from.
  const org = await prisma.organization.findUnique({
    where: { clerk_org_id: data.organization.id },
    select: { id: true },
  });
  if (!org) return;
  const user = await prisma.user.findFirst({
    where: { clerk_user_id: data.public_user_data.user_id, org_id: org.id },
    select: { id: true, deleted_at: true },
  });
  if (!user || user.deleted_at !== null) return;
  await prisma.user.update({
    where: { id: user.id },
    data: { deleted_at: new Date() },
  });
}

// ─── Helpers ────────────────────────────────────────────────────────────

async function ensureOrg(org: ClerkOrgPayload): Promise<{ id: string }> {
  const existing = await prisma.organization.findUnique({
    where: { clerk_org_id: org.id },
    select: { id: true },
  });
  if (existing) return existing;
  return prisma.organization.create({
    data: {
      clerk_org_id: org.id,
      name: org.name,
      ...CLERK_NEW_ORG_DEFAULTS,
      status: "Active",
    },
    select: { id: true },
  });
}

async function ensureUser(input: {
  clerkUserId: string;
  email: string;
  name: string | null;
  org_id: string;
}): Promise<{ id: string }> {
  const byClerkId = await prisma.user.findFirst({
    where: { clerk_user_id: input.clerkUserId, org_id: input.org_id },
    select: { id: true },
  });
  if (byClerkId) return byClerkId;

  const normalisedEmail = input.email.trim().toLowerCase();
  const byEmail = await prisma.user.findFirst({
    where: { email: normalisedEmail, org_id: input.org_id },
    select: { id: true },
  });
  if (byEmail) {
    await prisma.user.update({
      where: { id: byEmail.id },
      data: { clerk_user_id: input.clerkUserId },
    });
    return byEmail;
  }

  try {
    return await prisma.user.create({
      data: {
        clerk_user_id: input.clerkUserId,
        email: normalisedEmail,
        name: input.name,
        role: "Learner",
        ielts_track: "Academic",
        org_id: input.org_id,
      },
      select: { id: true },
    });
  } catch (err) {
    // Unique-constraint race: another concurrent webhook delivery beat us
    // to it. Fetch and return — final state is identical.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      const winner = await prisma.user.findFirst({
        where: { clerk_user_id: input.clerkUserId, org_id: input.org_id },
        select: { id: true },
      });
      if (winner) return winner;
    }
    throw err;
  }
}

export function pickPrimaryEmail(data: ClerkUserPayload): string | null {
  const primary = data.email_addresses.find(
    (e) => e.id === data.primary_email_address_id,
  );
  const raw = primary?.email_address ?? data.email_addresses[0]?.email_address;
  return raw ? raw.trim().toLowerCase() : null;
}

export function joinName(first: string | null, last: string | null): string | null {
  const joined = [first, last].filter(Boolean).join(" ").trim();
  return joined.length === 0 ? null : joined;
}

// Clerk's default org role identifiers are `org:admin` and `org:member`;
// custom roles can be added in the dashboard. Map known roles, default
// the rest to Learner so an unexpected role can never silently grant
// admin power.
export function mapClerkRole(role: string): Role {
  const normalised = role.replace(/^org:/, "").toLowerCase();
  if (normalised === "admin") return "OrgAdmin";
  return "Learner";
}
