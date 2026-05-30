import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClerkAPIResponseError } from "@clerk/backend/errors";
import { prisma } from "./client";
import { resetDatabase } from "./test-helpers";
import { SYSTEM_ORG_ID, SYSTEM_ORG_NAME } from "./system-org";
import {
  DEFAULT_SEED_PASSWORD,
  SeedPasswordError,
  resolveSeedPassword,
  seedClerkIdentities,
  splitName,
  type ClerkSeedClient,
} from "./clerk-seed";

// ─── Test fixtures ──────────────────────────────────────────────────────

// Mirrors the prisma/seed.ts shape on a much smaller scale: one SuperAdmin
// in Org A, one OrgAdmin per demo org, one Learner per demo org. Lets each
// test assert against a known cardinality without re-running the real seed.
async function seedMinimalDbRows(): Promise<void> {
  await prisma.organization.upsert({
    where: { id: SYSTEM_ORG_ID },
    update: { name: SYSTEM_ORG_NAME, status: "Archived" },
    create: {
      id: SYSTEM_ORG_ID,
      name: SYSTEM_ORG_NAME,
      seat_limit: 0,
      quota_daily: 0,
      quota_monthly: 0,
      status: "Archived",
    },
  });
  const orgA = await prisma.organization.create({
    data: {
      id: "test_org_a",
      name: "Demo English Academy",
      seat_limit: 25,
      quota_daily: 2000,
      quota_monthly: 40000,
    },
  });
  const orgB = await prisma.organization.create({
    data: {
      id: "test_org_b",
      name: "Migration Pathways Co",
      seat_limit: 10,
      quota_daily: 50,
      quota_monthly: 1000,
    },
  });
  await prisma.user.create({
    data: {
      org_id: orgA.id,
      email: "super@elanguage.dev",
      name: "Super Admin",
      role: "SuperAdmin",
    },
  });
  await prisma.user.create({
    data: {
      org_id: orgA.id,
      email: "admin-a@elanguage.dev",
      name: "Demo English Admin",
      role: "OrgAdmin",
    },
  });
  await prisma.user.create({
    data: {
      org_id: orgA.id,
      email: "learner-a1@elanguage.dev",
      name: "Anika Demo",
      role: "Learner",
    },
  });
  await prisma.user.create({
    data: {
      org_id: orgB.id,
      email: "admin-b@elanguage.dev",
      name: "Migration Pathways Admin",
      role: "OrgAdmin",
    },
  });
  await prisma.user.create({
    data: {
      org_id: orgB.id,
      email: "learner-b1@elanguage.dev",
      name: "Carmen Pathways",
      role: "Learner",
    },
  });
}

// Minimal in-memory fake of the Clerk surface area `seedClerkIdentities`
// touches. Records every call so tests can assert on payloads.
type CreateUserCall = {
  emailAddress: string[];
  password?: string;
  firstName?: string;
  lastName?: string;
};
type CreateOrgCall = { name: string; createdBy?: string };
type CreateMembershipCall = {
  organizationId: string;
  userId: string;
  role: string;
};

interface FakeClerkOptions {
  /** Seed Clerk-side users that already exist before the seed runs (by email). */
  existingUsers?: Array<{ email: string; id: string }>;
  /** Seed Clerk-side orgs that already exist before the seed runs (by name). */
  existingOrgs?: Array<{ name: string; id: string }>;
  /** Make createUser throw a synthetic Clerk error for these emails. */
  createUserError?: Map<string, unknown>;
  /** Make createOrganization throw for these names. */
  createOrgError?: Map<string, unknown>;
  /** Make createOrganizationMembership throw N times before succeeding. */
  membershipError?: unknown;
}

function makeFakeClerk(opts: FakeClerkOptions = {}): {
  client: ClerkSeedClient;
  calls: {
    createUser: CreateUserCall[];
    getUserList: Array<{ emailAddress: string[] }>;
    createOrg: CreateOrgCall[];
    getOrgList: Array<{ query?: string }>;
    createMembership: CreateMembershipCall[];
  };
} {
  const usersByEmail = new Map<string, string>();
  for (const u of opts.existingUsers ?? []) {
    usersByEmail.set(u.email.toLowerCase(), u.id);
  }
  const orgsByName = new Map<string, string>();
  for (const o of opts.existingOrgs ?? []) {
    orgsByName.set(o.name, o.id);
  }
  let nextUserId = 1000;
  let nextOrgId = 5000;

  const calls = {
    createUser: [] as CreateUserCall[],
    getUserList: [] as Array<{ emailAddress: string[] }>,
    createOrg: [] as CreateOrgCall[],
    getOrgList: [] as Array<{ query?: string }>,
    createMembership: [] as CreateMembershipCall[],
  };

  const client: ClerkSeedClient = {
    users: {
      async createUser(params) {
        calls.createUser.push(params);
        const email = params.emailAddress[0]?.toLowerCase() ?? "";
        if (opts.createUserError?.has(email)) {
          throw opts.createUserError.get(email);
        }
        if (usersByEmail.has(email)) {
          throw makeClerkError(422, "form_identifier_exists");
        }
        const id = `user_${nextUserId++}`;
        usersByEmail.set(email, id);
        return { id };
      },
      async getUserList(params) {
        calls.getUserList.push(params);
        const data: Array<{ id: string }> = [];
        for (const raw of params.emailAddress) {
          const id = usersByEmail.get(raw.toLowerCase());
          if (id) data.push({ id });
        }
        return { data };
      },
    },
    organizations: {
      async createOrganization(params) {
        calls.createOrg.push(params);
        if (opts.createOrgError?.has(params.name)) {
          throw opts.createOrgError.get(params.name);
        }
        if (orgsByName.has(params.name)) {
          throw makeClerkError(422, "duplicate_record");
        }
        const id = `org_${nextOrgId++}`;
        orgsByName.set(params.name, id);
        return { id };
      },
      async getOrganizationList(params) {
        calls.getOrgList.push(params);
        const data = [...orgsByName.entries()]
          .filter(([name]) => !params.query || name.includes(params.query))
          .map(([name, id]) => ({ id, name }));
        return { data };
      },
      async createOrganizationMembership(params) {
        calls.createMembership.push(params);
        if (opts.membershipError) {
          const e = opts.membershipError;
          opts.membershipError = undefined; // throw once
          throw e;
        }
        return {};
      },
    },
  };
  return { client, calls };
}

function makeClerkError(status: number, code: string): Error {
  // Use the real class so `isClerkAPIResponseError` (which checks
  // constructor.kind / instanceof) recognises it. Going via a duck-typed
  // plain Error silently fails the guard and routes the error down the
  // generic-rethrow branch.
  return new ClerkAPIResponseError(`[clerk ${status}] ${code}`, {
    data: [{ code, message: code, long_message: code, meta: {} }],
    status,
    clerkTraceId: undefined,
    retryAfter: undefined,
  });
}

// ─── Lifecycle ──────────────────────────────────────────────────────────

const originalEnv = { ...process.env };

beforeEach(async () => {
  await resetDatabase();
  // Clean slate for env-guarded paths. Tests re-set what they need.
  delete process.env.SEED_SKIP_CLERK;
  delete process.env.SEED_DEFAULT_PASSWORD;
  process.env.NODE_ENV = "test";
  process.env.CLERK_SECRET_KEY = "sk_test_seed_fixture";
});

afterEach(() => {
  process.env = { ...originalEnv };
});

// ─── Pure helpers ───────────────────────────────────────────────────────

describe("splitName", () => {
  it("splits on the first space", () => {
    expect(splitName("Super Admin")).toEqual({
      firstName: "Super",
      lastName: "Admin",
    });
  });
  it("keeps multi-word last names whole", () => {
    expect(splitName("Anika de la Vega")).toEqual({
      firstName: "Anika",
      lastName: "de la Vega",
    });
  });
  it("returns firstName only for single-token names", () => {
    expect(splitName("Madonna")).toEqual({ firstName: "Madonna", lastName: "" });
  });
  it("returns empty strings for null/empty input", () => {
    expect(splitName(null)).toEqual({ firstName: "", lastName: "" });
    expect(splitName("   ")).toEqual({ firstName: "", lastName: "" });
  });
});

describe("resolveSeedPassword", () => {
  it("returns the default when SEED_DEFAULT_PASSWORD is unset", () => {
    expect(resolveSeedPassword({})).toBe(DEFAULT_SEED_PASSWORD);
  });
  it("respects an override that passes validation", () => {
    expect(resolveSeedPassword({ SEED_DEFAULT_PASSWORD: "another-long-one-99" })).toBe(
      "another-long-one-99",
    );
  });
  it("rejects passwords shorter than 8 characters", () => {
    expect(() => resolveSeedPassword({ SEED_DEFAULT_PASSWORD: "short" })).toThrow(
      SeedPasswordError,
    );
  });
  it("rejects passwords on the obvious-weak denylist", () => {
    expect(() =>
      resolveSeedPassword({ SEED_DEFAULT_PASSWORD: "password123" }),
    ).toThrow(SeedPasswordError);
    expect(() =>
      resolveSeedPassword({ SEED_DEFAULT_PASSWORD: "PASSWORD123" }),
    ).toThrow(SeedPasswordError);
  });
});

// ─── Pre-flight guards ──────────────────────────────────────────────────

describe("seedClerkIdentities pre-flight guards", () => {
  it("short-circuits with status=skipped-flag when SEED_SKIP_CLERK=1", async () => {
    process.env.SEED_SKIP_CLERK = "1";
    await seedMinimalDbRows();
    const { client, calls } = makeFakeClerk();
    const result = await seedClerkIdentities({ clerkClient: client, logger: () => {} });
    expect(result.status).toBe("skipped-flag");
    expect(calls.createUser).toHaveLength(0);
    expect(calls.createOrg).toHaveLength(0);
    expect(calls.createMembership).toHaveLength(0);
  });

  it("refuses to run when NODE_ENV=production", async () => {
    process.env.NODE_ENV = "production";
    await seedMinimalDbRows();
    const { client } = makeFakeClerk();
    await expect(
      seedClerkIdentities({ clerkClient: client, logger: () => {} }),
    ).rejects.toThrow(/NODE_ENV=production/);
  });

  it("refuses to run when CLERK_SECRET_KEY is unset", async () => {
    delete process.env.CLERK_SECRET_KEY;
    await seedMinimalDbRows();
    const { client } = makeFakeClerk();
    await expect(
      seedClerkIdentities({ clerkClient: client, logger: () => {} }),
    ).rejects.toThrow(/CLERK_SECRET_KEY/);
  });

  it("refuses to run when SEED_DEFAULT_PASSWORD is too short", async () => {
    process.env.SEED_DEFAULT_PASSWORD = "short";
    await seedMinimalDbRows();
    const { client } = makeFakeClerk();
    await expect(
      seedClerkIdentities({ clerkClient: client, logger: () => {} }),
    ).rejects.toThrow(SeedPasswordError);
  });
});

// ─── Happy path + idempotency ───────────────────────────────────────────

describe("seedClerkIdentities happy path", () => {
  it("creates Clerk users for every unlinked DB user and stamps clerk_user_id", async () => {
    await seedMinimalDbRows();
    const { client, calls } = makeFakeClerk();
    const result = await seedClerkIdentities({ clerkClient: client, logger: () => {} });

    expect(result.status).toBe("ok");
    expect(result.usersCreated).toBe(5); // 1 super + 2 admins + 2 learners
    expect(result.usersLinked).toBe(0);

    const after = await prisma.user.findMany({
      select: { email: true, clerk_user_id: true },
      orderBy: { email: "asc" },
    });
    expect(after.every((u) => u.clerk_user_id !== null)).toBe(true);
    expect(calls.createUser.every((c) => c.password === DEFAULT_SEED_PASSWORD)).toBe(true);
  });

  it("creates Clerk orgs for every unlinked non-system org with SuperAdmin as createdBy", async () => {
    await seedMinimalDbRows();
    const { client, calls } = makeFakeClerk();
    const result = await seedClerkIdentities({ clerkClient: client, logger: () => {} });

    expect(result.orgsCreated).toBe(2);
    expect(result.orgsLinked).toBe(0);

    // System org must NEVER be mirrored to Clerk.
    expect(calls.createOrg.map((c) => c.name)).not.toContain(SYSTEM_ORG_NAME);

    // Both creates used the same SuperAdmin Clerk id as createdBy.
    const superUserCall = calls.createUser.find((c) =>
      c.emailAddress.includes("super@elanguage.dev"),
    );
    expect(superUserCall).toBeDefined();
    const createdBys = new Set(calls.createOrg.map((c) => c.createdBy));
    expect(createdBys.size).toBe(1);

    const systemAfter = await prisma.organization.findUnique({
      where: { id: SYSTEM_ORG_ID },
      select: { clerk_org_id: true },
    });
    expect(systemAfter?.clerk_org_id).toBeNull();
  });

  it("creates exactly one admin membership for SuperAdmin (home org) + each OrgAdmin, none for Learners", async () => {
    await seedMinimalDbRows();
    const { client, calls } = makeFakeClerk();
    const result = await seedClerkIdentities({ clerkClient: client, logger: () => {} });

    expect(result.membershipsCreated).toBe(3); // super + 2 OrgAdmins
    expect(result.learnerMembershipsSkipped).toBe(2);
    expect(calls.createMembership.every((c) => c.role === "org:admin")).toBe(true);

    // Cross-check by Clerk-user-id: no Learner email's id appears in any
    // membership call.
    const learnerCall = calls.createUser.find((c) =>
      c.emailAddress[0]?.startsWith("learner-"),
    );
    expect(learnerCall).toBeDefined();
    // Learner's createUser was the Nth invocation; mirror our own user-id
    // assignment (user_1000, user_1001, ...).
    const learnerEmails = ["learner-a1@elanguage.dev", "learner-b1@elanguage.dev"];
    for (const email of learnerEmails) {
      const learner = await prisma.user.findFirst({
        where: { email },
        select: { clerk_user_id: true },
      });
      const learnerClerkId = learner?.clerk_user_id;
      expect(learnerClerkId).toBeDefined();
      expect(calls.createMembership.some((c) => c.userId === learnerClerkId)).toBe(false);
    }
  });

  it("places SuperAdmin in exactly one Clerk org membership (their home org), not all orgs", async () => {
    await seedMinimalDbRows();
    const { client, calls } = makeFakeClerk();
    await seedClerkIdentities({ clerkClient: client, logger: () => {} });

    const superRow = await prisma.user.findFirst({
      where: { email: "super@elanguage.dev" },
      select: { clerk_user_id: true, org_id: true },
    });
    const superHomeOrg = await prisma.organization.findUnique({
      where: { id: superRow!.org_id },
      select: { clerk_org_id: true },
    });

    const superMemberships = calls.createMembership.filter(
      (c) => c.userId === superRow!.clerk_user_id,
    );
    expect(superMemberships).toHaveLength(1);
    expect(superMemberships[0]?.organizationId).toBe(superHomeOrg!.clerk_org_id);
  });
});

// ─── Lazy fetch on form_identifier_exists ──────────────────────────────

describe("seedClerkIdentities lazy fetch", () => {
  it("re-discovers an existing Clerk user when createUser returns form_identifier_exists", async () => {
    await seedMinimalDbRows();
    const { client, calls } = makeFakeClerk({
      existingUsers: [{ email: "super@elanguage.dev", id: "user_preexisting" }],
    });
    const result = await seedClerkIdentities({ clerkClient: client, logger: () => {} });

    expect(result.usersLinked).toBe(1);
    expect(result.usersCreated).toBe(4); // remaining 4 still created
    expect(calls.getUserList).toHaveLength(1);

    const super_ = await prisma.user.findFirst({
      where: { email: "super@elanguage.dev" },
      select: { clerk_user_id: true },
    });
    expect(super_?.clerk_user_id).toBe("user_preexisting");
  });
});

// ─── Idempotency (re-run) ──────────────────────────────────────────────

describe("seedClerkIdentities idempotency", () => {
  it("is a no-op on the second run — every row already linked", async () => {
    await seedMinimalDbRows();
    const { client: clientA } = makeFakeClerk();
    await seedClerkIdentities({ clerkClient: clientA, logger: () => {} });

    // Second run reuses the same fake (its in-memory Clerk state is gone,
    // but the DB now has clerk_user_id / clerk_org_id stamped on every
    // row, so the seed must not touch Clerk at all).
    const { client: clientB, calls } = makeFakeClerk();
    const second = await seedClerkIdentities({ clerkClient: clientB, logger: () => {} });

    expect(calls.createUser).toHaveLength(0);
    expect(calls.createOrg).toHaveLength(0);
    expect(second.usersCreated).toBe(0);
    expect(second.usersLinked).toBe(0);
    expect(second.orgsCreated).toBe(0);
    expect(second.orgsLinked).toBe(0);

    // Memberships ARE re-attempted (we don't store a "membership linked"
    // bit on the DB row), and Clerk would normally 422 with
    // `already_a_member_in_organization`. The fresh fake has no record of
    // the prior memberships, so they're re-created. That's fine: real
    // Clerk will reject them and the seed will count them as already-
    // present (covered separately in the next test).
    expect(second.membershipsCreated).toBe(3);
  });

  it("treats already_a_member_in_organization as success", async () => {
    await seedMinimalDbRows();
    const { client, calls } = makeFakeClerk({
      membershipError: makeClerkError(422, "already_a_member_in_organization"),
    });
    const result = await seedClerkIdentities({ clerkClient: client, logger: () => {} });

    expect(result.membershipsAlreadyPresent).toBe(1);
    expect(calls.createMembership.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── Surface unexpected Clerk errors ───────────────────────────────────

describe("seedClerkIdentities error surface", () => {
  it("rethrows non-recognised Clerk createUser failures", async () => {
    await seedMinimalDbRows();
    const errs = new Map<string, unknown>([
      ["super@elanguage.dev", makeClerkError(500, "internal_server_error")],
    ]);
    const { client } = makeFakeClerk({ createUserError: errs });
    await expect(
      seedClerkIdentities({ clerkClient: client, logger: () => {} }),
    ).rejects.toThrow();
  });

  it("rethrows pwned-password rejection with a clear SeedPasswordError", async () => {
    await seedMinimalDbRows();
    const errs = new Map<string, unknown>([
      ["super@elanguage.dev", makeClerkError(422, "form_password_pwned")],
    ]);
    const { client } = makeFakeClerk({ createUserError: errs });
    await expect(
      seedClerkIdentities({ clerkClient: client, logger: () => {} }),
    ).rejects.toThrow(SeedPasswordError);
  });
});

// Keep vitest from complaining about an unused vi import if a future test
// inlines mocks.
void vi;
