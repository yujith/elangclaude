// Seed-time Clerk-side mirror of the rows that prisma/seed.ts creates.
// Runs as the final step of `pnpm db:seed` so every demo email can sign in
// immediately with the shared dev password, without any extra setup.
//
// SAFETY (belt + braces): this function refuses to execute against a real
// Clerk instance unless BOTH conditions hold:
//   1. NODE_ENV !== "production"  (no shared password ever touches a prod
//      Clerk tenant — full stop)
//   2. CLERK_SECRET_KEY is set    (so a prod deploy that forgets to supply
//      a key can't accidentally hit Clerk at all)
// The escape hatch `SEED_SKIP_CLERK=1` short-circuits the whole function for
// offline dev (e.g. on a plane / when Clerk is down).
//
// TENANCY NOTE: this module uses the raw `prisma` client (not `withOrg`)
// because the seed runs without an OrgContext — same exception as
// clerk-sync.ts. It must never be reachable from application code paths.
//
// IDEMPOTENCY: every Clerk-side call is either a no-op (DB row already
// linked) or a lookup-then-stamp fallback (the row exists in Clerk from a
// previous run, we re-discover it and stamp the id on our DB row). Re-runs
// of `pnpm db:seed` therefore never produce duplicate Clerk users or orgs.

import { createClerkClient } from "@clerk/backend";
import { isClerkAPIResponseError } from "@clerk/backend/errors";
import type { Role } from "@prisma/client";
import { prisma } from "./client";
import { SYSTEM_ORG_ID } from "./system-org";

// ─── Public types ───────────────────────────────────────────────────────

/**
 * The minimal Clerk surface area `seedClerkIdentities` actually uses. Letting
 * tests pass a stub here keeps `vi.mock("@clerk/backend")` (which is awkward
 * because of the package's ESM re-export structure) out of the picture.
 */
export interface ClerkSeedClient {
  users: {
    createUser(params: {
      emailAddress: string[];
      password?: string;
      firstName?: string;
      lastName?: string;
      skipPasswordChecks?: boolean;
    }): Promise<{ id: string }>;
    getUserList(params: {
      emailAddress: string[];
    }): Promise<{ data: Array<{ id: string }> }>;
  };
  organizations: {
    createOrganization(params: {
      name: string;
      createdBy?: string;
    }): Promise<{ id: string }>;
    getOrganizationList(params: {
      query?: string;
      limit?: number;
    }): Promise<{ data: Array<{ id: string; name: string }> }>;
    createOrganizationMembership(params: {
      organizationId: string;
      userId: string;
      role: string;
    }): Promise<unknown>;
  };
}

export interface SeedClerkIdentitiesOptions {
  /** Inject a fake for tests; production omits this and we build a real client. */
  clerkClient?: ClerkSeedClient;
  /** Defaults to console.log; tests can capture or silence output. */
  logger?: (msg: string) => void;
}

export interface SeedClerkIdentitiesResult {
  status: "skipped-flag" | "ok";
  usersCreated: number;
  usersLinked: number;
  orgsCreated: number;
  orgsLinked: number;
  membershipsCreated: number;
  membershipsAlreadyPresent: number;
  learnerMembershipsSkipped: number;
}

// ─── Password validation ────────────────────────────────────────────────

/** The shared dev password. Override with SEED_DEFAULT_PASSWORD if needed. */
export const DEFAULT_SEED_PASSWORD = "elanguagecenter2026!";

/**
 * A tiny "obviously weak" denylist for the seed password. Catches the kind
 * of override a half-asleep dev might paste in without us paying for an
 * HIBP roundtrip. Anything genuinely pwned that slips past this list will
 * still be rejected by Clerk's server-side check (skipPasswordChecks: false,
 * which is the default) — we surface that error with a clearer message.
 */
const OBVIOUSLY_WEAK_PASSWORDS = new Set([
  "password",
  "password1",
  "password123",
  "12345678",
  "123456789",
  "qwerty12",
  "qwerty123",
  "letmein!",
  "admin123",
  "changeme",
]);

export class SeedPasswordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeedPasswordError";
  }
}

export function resolveSeedPassword(env: NodeJS.ProcessEnv = process.env): string {
  const candidate = env.SEED_DEFAULT_PASSWORD ?? DEFAULT_SEED_PASSWORD;
  if (candidate.length < 8) {
    throw new SeedPasswordError(
      "SEED_DEFAULT_PASSWORD must be at least 8 characters long.",
    );
  }
  if (OBVIOUSLY_WEAK_PASSWORDS.has(candidate.toLowerCase())) {
    throw new SeedPasswordError(
      "SEED_DEFAULT_PASSWORD is on the obvious-weak denylist. Pick something else.",
    );
  }
  return candidate;
}

// ─── Name split ─────────────────────────────────────────────────────────

/**
 * Our schema stores a single `name`. Clerk wants first + last separately for
 * email-template personalisation. Split on the first space — anything after
 * goes into lastName. Single-token names stay as firstName only.
 */
export function splitName(full: string | null): {
  firstName: string;
  lastName: string;
} {
  const trimmed = (full ?? "").trim();
  if (!trimmed) return { firstName: "", lastName: "" };
  const idx = trimmed.indexOf(" ");
  if (idx === -1) return { firstName: trimmed, lastName: "" };
  return {
    firstName: trimmed.slice(0, idx),
    lastName: trimmed.slice(idx + 1).trim(),
  };
}

// ─── Entry point ────────────────────────────────────────────────────────

export async function seedClerkIdentities(
  options: SeedClerkIdentitiesOptions = {},
): Promise<SeedClerkIdentitiesResult> {
  const log = options.logger ?? ((msg: string) => console.log(msg));

  // ─── Pre-flight guards (order matters — checked by tests) ────────────

  if (process.env.SEED_SKIP_CLERK === "1") {
    log("[clerk-seed] SEED_SKIP_CLERK=1 — skipping Clerk identity seeding.");
    return emptyResult("skipped-flag");
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Refusing to seed Clerk identities: NODE_ENV=production. " +
        "The seed creates users with a shared dev password and must never " +
        "run against a production Clerk tenant.",
    );
  }

  if (!process.env.CLERK_SECRET_KEY) {
    throw new Error(
      "Refusing to seed Clerk identities: CLERK_SECRET_KEY is not set. " +
        "Either set the dev key in packages/db/.env, or set " +
        "SEED_SKIP_CLERK=1 to run the seed without touching Clerk.",
    );
  }

  const password = resolveSeedPassword();

  const clerk: ClerkSeedClient =
    options.clerkClient ??
    (createClerkClient({
      secretKey: process.env.CLERK_SECRET_KEY,
    }) as unknown as ClerkSeedClient);

  // ─── Load the seeded rows that need Clerk mirroring ──────────────────

  const dbUsers = await prisma.user.findMany({
    where: { deleted_at: null },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      org_id: true,
      clerk_user_id: true,
    },
    orderBy: [{ role: "asc" }, { email: "asc" }],
  });

  // SuperAdmin must be processed first so that `createdBy` for orgs (which
  // requires an existing Clerk user id) has a real id to point at.
  dbUsers.sort((a, b) => roleRank(a.role) - roleRank(b.role));

  const dbOrgs = await prisma.organization.findMany({
    where: { id: { not: SYSTEM_ORG_ID } },
    select: { id: true, name: true, clerk_org_id: true },
    orderBy: { name: "asc" },
  });

  const result = emptyResult("ok");

  // ─── Pass 1: Clerk users ─────────────────────────────────────────────

  // Track the freshly-resolved Clerk user id for every DB user so passes 2/3
  // don't need to re-read the DB.
  const clerkUserIdByDbId = new Map<string, string>();

  for (const user of dbUsers) {
    if (user.clerk_user_id) {
      clerkUserIdByDbId.set(user.id, user.clerk_user_id);
      continue;
    }

    const { firstName, lastName } = splitName(user.name);

    let clerkUserId: string;
    try {
      const created = await clerk.users.createUser({
        emailAddress: [user.email],
        password,
        firstName: firstName || undefined,
        lastName: lastName || undefined,
        // Defaults to false — keep it explicit so a future Clerk default
        // change can't silently weaken us. HIBP rejection here surfaces a
        // clear actionable error to whoever ran `pnpm db:seed`.
        skipPasswordChecks: false,
      });
      clerkUserId = created.id;
      result.usersCreated += 1;
    } catch (err) {
      if (isPasswordCompromised(err)) {
        throw new SeedPasswordError(
          "SEED_DEFAULT_PASSWORD was rejected by Clerk's pwned-password check. " +
            "Pick a different password and re-run the seed.",
        );
      }
      if (isIdentifierExists(err)) {
        const existing = await clerk.users.getUserList({
          emailAddress: [user.email],
        });
        const found = existing.data[0];
        if (!found) {
          throw new Error(
            `Clerk reported ${user.email} as already-existing on create, ` +
              "but getUserList returned no match. Refusing to continue.",
          );
        }
        clerkUserId = found.id;
        result.usersLinked += 1;
      } else {
        throw err;
      }
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { clerk_user_id: clerkUserId },
    });
    clerkUserIdByDbId.set(user.id, clerkUserId);
  }

  // ─── Pass 2: Clerk organizations ─────────────────────────────────────

  // Use the SuperAdmin's Clerk id as `createdBy` so the org has a real
  // owner. The seed always creates exactly one SuperAdmin; if zero exist,
  // there's nothing to seed orgs against, so we fail loudly.
  const superAdminDbRow = dbUsers.find((u) => u.role === "SuperAdmin");
  if (!superAdminDbRow) {
    throw new Error(
      "No SuperAdmin found in DB. seed.ts must create the SuperAdmin " +
        "before seedClerkIdentities() runs.",
    );
  }
  const superClerkId = clerkUserIdByDbId.get(superAdminDbRow.id);
  if (!superClerkId) {
    throw new Error("SuperAdmin has no Clerk id after pass 1 — bug.");
  }

  const clerkOrgIdByDbId = new Map<string, string>();
  for (const org of dbOrgs) {
    if (org.clerk_org_id) {
      clerkOrgIdByDbId.set(org.id, org.clerk_org_id);
      continue;
    }

    // Re-discover before creating: if a previous run created the org but
    // crashed before stamping `clerk_org_id`, the name will already be in
    // Clerk. Querying by name avoids producing a duplicate.
    const existing = await clerk.organizations.getOrganizationList({
      query: org.name,
      limit: 10,
    });
    const exact = existing.data.find((o) => o.name === org.name);

    let clerkOrgId: string;
    if (exact) {
      clerkOrgId = exact.id;
      result.orgsLinked += 1;
    } else {
      const created = await clerk.organizations.createOrganization({
        name: org.name,
        createdBy: superClerkId,
      });
      clerkOrgId = created.id;
      result.orgsCreated += 1;
    }

    await prisma.organization.update({
      where: { id: org.id },
      data: { clerk_org_id: clerkOrgId },
    });
    clerkOrgIdByDbId.set(org.id, clerkOrgId);
  }

  // ─── Pass 3: Clerk org memberships ───────────────────────────────────
  //
  // Decision #2 of the plan: Learners do NOT get a Clerk org membership.
  // `requireOrgContext` reads org_id from our DB User row, so a Clerk
  // membership for a Learner would be unused state that drifts (e.g. a
  // soft-deleted Learner would stay "in" the Clerk org). SuperAdmin gets
  // exactly one membership — their home org (Org A in the standard seed) —
  // because their cross-org powers come from the DB `role` column, not
  // from membership in every Clerk org.

  for (const user of dbUsers) {
    if (user.role === "Learner") {
      result.learnerMembershipsSkipped += 1;
      continue;
    }

    const clerkUserId = clerkUserIdByDbId.get(user.id);
    const clerkOrgId = clerkOrgIdByDbId.get(user.org_id);
    if (!clerkUserId || !clerkOrgId) {
      // Either the user lives in the system org (SuperAdmin's parking
      // spot is Org A, so this shouldn't happen) or org seeding was
      // skipped. Either way: nothing to do.
      continue;
    }

    try {
      await clerk.organizations.createOrganizationMembership({
        organizationId: clerkOrgId,
        userId: clerkUserId,
        // Clerk system roles use the `org:` prefix. The unprefixed legacy
        // names ("admin" / "basic_member") return 404 "Organization role
        // not found" on instances created after the role-key change.
        role: "org:admin",
      });
      result.membershipsCreated += 1;
    } catch (err) {
      if (isAlreadyMember(err)) {
        result.membershipsAlreadyPresent += 1;
        continue;
      }
      throw err;
    }
  }

  log(
    `[clerk-seed] done: ${result.usersCreated} users created, ` +
      `${result.usersLinked} linked; ${result.orgsCreated} orgs created, ` +
      `${result.orgsLinked} linked; ${result.membershipsCreated} memberships ` +
      `created, ${result.membershipsAlreadyPresent} already present, ` +
      `${result.learnerMembershipsSkipped} Learner memberships skipped.`,
  );

  return result;
}

// ─── Helpers ────────────────────────────────────────────────────────────

function emptyResult(status: SeedClerkIdentitiesResult["status"]): SeedClerkIdentitiesResult {
  return {
    status,
    usersCreated: 0,
    usersLinked: 0,
    orgsCreated: 0,
    orgsLinked: 0,
    membershipsCreated: 0,
    membershipsAlreadyPresent: 0,
    learnerMembershipsSkipped: 0,
  };
}

// Process SuperAdmin first, then OrgAdmin, then Learners — so `createdBy`
// for orgs in pass 2 always has a real Clerk id to reference.
function roleRank(role: Role): number {
  if (role === "SuperAdmin") return 0;
  if (role === "OrgAdmin") return 1;
  return 2;
}

function hasErrorCode(err: unknown, code: string): boolean {
  if (!isClerkAPIResponseError(err)) return false;
  return err.errors.some((e: { code: string }) => e.code === code);
}

function isIdentifierExists(err: unknown): boolean {
  // Clerk returns 422 with code `form_identifier_exists` when an email is
  // already attached to a user in the instance.
  return hasErrorCode(err, "form_identifier_exists");
}

function isPasswordCompromised(err: unknown): boolean {
  // Clerk's HIBP-backed check on createUser. Both codes seen in the wild
  // depending on whether the password is "weak" or "pwned"; treat them
  // identically — the dev needs to pick a different password either way.
  return (
    hasErrorCode(err, "form_password_pwned") ||
    hasErrorCode(err, "form_password_validation_failed") ||
    hasErrorCode(err, "form_password_size_in_bytes_exceeded") ||
    hasErrorCode(err, "form_password_length_too_short")
  );
}

function isAlreadyMember(err: unknown): boolean {
  return (
    hasErrorCode(err, "already_a_member_in_organization") ||
    hasErrorCode(err, "organization_membership_already_exists") ||
    hasErrorCode(err, "duplicate_record")
  );
}
