import { beforeEach, describe, expect, it } from "vitest";
import { ClerkAPIResponseError } from "@clerk/backend/errors";
import { prisma } from "./client";
import { resetDatabase } from "./test-helpers";
import {
  CSV_ROW_CAP,
  InviteEnvError,
  inviteLearnerForOrg,
  inviteLearnersFromCsvForOrg,
  parseInviteCsv,
  type InviteClerkClient,
  type InviteOptions,
} from "./admin-invite";
import type { OrgContext } from "./tenancy";

async function makeOrg(seat_limit: number) {
  const org = await prisma.organization.create({
    data: {
      name: `Org ${Math.random().toString(16).slice(2, 8)}`,
      seat_limit,
      quota_daily: 100,
      quota_monthly: 1000,
    },
  });
  const admin = await prisma.user.create({
    data: {
      org_id: org.id,
      email: `admin-${Math.random().toString(16).slice(2, 8)}@elanguage.test`,
      role: "OrgAdmin",
    },
  });
  const ctx: OrgContext = {
    org_id: org.id,
    user_id: admin.id,
    role: "OrgAdmin",
  };
  return { org, admin, ctx };
}

// ─── Test doubles for the Clerk side ────────────────────────────────────

type InviteCall = {
  emailAddress: string;
  redirectUrl?: string;
  publicMetadata?: Record<string, unknown>;
};

function makeFakeClerk(opts: {
  /** Sequence of behaviours applied to each createInvitation call, in
   *  order. "ok" = succeed; ClerkLikeError = throw it. Stays the last
   *  entry once exhausted (so a single-entry array always behaves the
   *  same way). */
  behaviours?: Array<"ok" | Error>;
} = {}): { client: InviteClerkClient; calls: InviteCall[] } {
  const calls: InviteCall[] = [];
  const seq = opts.behaviours ?? ["ok"];
  let cursor = 0;
  const client: InviteClerkClient = {
    invitations: {
      async createInvitation(params) {
        calls.push(params);
        const behaviour = seq[Math.min(cursor, seq.length - 1)];
        cursor += 1;
        if (behaviour === "ok") return { id: `inv_${calls.length}` };
        throw behaviour;
      },
    },
  };
  return { client, calls };
}

/** Build a real ClerkAPIResponseError instance. The runtime type-guard
 *  matches `constructor.kind === "ClerkAPIResponseError"`, so a plain
 *  Error-with-fields stub won't pass — we have to construct the actual
 *  class the SDK exports. */
function makeClerkError(opts: {
  status: number;
  code: string;
  message?: string;
}): Error {
  return new ClerkAPIResponseError(opts.message ?? opts.code, {
    data: [
      {
        code: opts.code,
        message: opts.message ?? opts.code,
        long_message: opts.message ?? opts.code,
        meta: {},
      },
    ],
    status: opts.status,
    clerkTraceId: "test-trace",
  });
}

function makeOptions(
  overrides: Partial<InviteOptions> = {},
): InviteOptions {
  const { client } = makeFakeClerk();
  return {
    clerkClient: client,
    appUrl: "http://test.local",
    sleep: async () => {},
    ...overrides,
  };
}

// ─── parseInviteCsv (pure, no DB / Clerk) ───────────────────────────────

describe("parseInviteCsv", () => {
  it("skips a leading email-named header row", () => {
    const out = parseInviteCsv("email,name\nasha@example.com,Asha\nben@example.com,Ben");
    expect(out.rows).toHaveLength(2);
    expect(out.rows[0]?.email).toBe("asha@example.com");
    expect(out.rows[1]?.name).toBe("Ben");
  });

  it("handles bare emails without a name column", () => {
    const out = parseInviteCsv("alice@example.com\nbob@example.com\n");
    expect(out.rows).toHaveLength(2);
    expect(out.rows.every((r) => r.name === null)).toBe(true);
  });

  it("ignores blank lines and reports the source row number", () => {
    const out = parseInviteCsv("\nfirst@example.com,First\n\n\nsecond@example.com,Second");
    expect(out.rows).toHaveLength(2);
    expect(out.rows[0]?.row).toBe(2);
    expect(out.rows[1]?.row).toBe(5);
  });

  it("truncates beyond CSV_ROW_CAP", () => {
    const lines: string[] = [];
    for (let i = 0; i < CSV_ROW_CAP + 5; i++) {
      lines.push(`u${i}@example.com`);
    }
    const out = parseInviteCsv(lines.join("\n"));
    expect(out.rows).toHaveLength(CSV_ROW_CAP);
    expect(out.truncatedAt).toBe(CSV_ROW_CAP + 1);
  });
});

// ─── inviteLearnerForOrg (DB + Clerk) ───────────────────────────────────

describe("inviteLearnerForOrg", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("creates a Learner, sets ielts_track=Academic, writes an ActivityLog", async () => {
    const { ctx, org } = await makeOrg(5);
    const { client, calls } = makeFakeClerk();
    const res = await inviteLearnerForOrg(
      ctx,
      { email: "Alice@Example.com", name: "Alice" },
      makeOptions({ clerkClient: client }),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("unreachable");

    const user = await prisma.user.findUnique({ where: { id: res.user_id } });
    expect(user?.email).toBe("alice@example.com");
    expect(user?.role).toBe("Learner");
    expect(user?.ielts_track).toBe("Academic");
    expect(user?.org_id).toBe(org.id);

    const log = await prisma.activityLog.findFirst({
      where: { org_id: org.id, action: "learner.invited" },
    });
    expect(log).not.toBeNull();
    expect((log?.metadata as Record<string, unknown>).invited_email).toBe(
      "alice@example.com",
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.emailAddress).toBe("alice@example.com");
    expect(calls[0]?.redirectUrl).toBe("http://test.local/sign-up");
    expect(calls[0]?.publicMetadata).toEqual({ org_id: org.id, role: "Learner" });
  });

  it("is idempotent — re-inviting an existing in-org learner returns alreadyExisted", async () => {
    const { ctx } = await makeOrg(5);
    const a = await inviteLearnerForOrg(
      ctx,
      { email: "dup@example.com" },
      makeOptions(),
    );
    expect(a.ok).toBe(true);
    const b = await inviteLearnerForOrg(
      ctx,
      { email: "DUP@example.com" },
      makeOptions(),
    );
    expect(b.ok).toBe(true);
    if (!a.ok || !b.ok) throw new Error("unreachable");
    expect(b.user_id).toBe(a.user_id);
    expect(b.alreadyExisted).toBe(true);
  });

  it("blocks the (seat_limit + 1)-th invite with seat_limit_reached", async () => {
    const { ctx } = await makeOrg(3);
    for (let i = 0; i < 3; i++) {
      const r = await inviteLearnerForOrg(
        ctx,
        { email: `seat-${i}@example.com` },
        makeOptions(),
      );
      expect(r.ok).toBe(true);
    }
    const fourth = await inviteLearnerForOrg(
      ctx,
      { email: "overflow@example.com" },
      makeOptions(),
    );
    expect(fourth.ok).toBe(false);
    if (fourth.ok) throw new Error("unreachable");
    expect(fourth.reason).toBe("seat_limit_reached");
  });

  it("allows a cross-org email to create a learner in a second org (ADR-0018)", async () => {
    const a = await makeOrg(5);
    const b = await makeOrg(5);
    const inA = await inviteLearnerForOrg(
      a.ctx,
      { email: "shared@example.com" },
      makeOptions(),
    );
    expect(inA.ok).toBe(true);
    // With multi-org, same email can exist in different orgs
    const inB = await inviteLearnerForOrg(
      b.ctx,
      { email: "shared@example.com" },
      makeOptions(),
    );
    expect(inB.ok).toBe(true);
    if (!inB.ok) throw new Error("unexpected failure");
    // The two rows should be separate users in different orgs
    const userInA = await prisma.user.findFirst({
      where: { email: "shared@example.com", org_id: a.org.id },
    });
    const userInB = await prisma.user.findFirst({
      where: { email: "shared@example.com", org_id: b.org.id },
    });
    expect(userInA?.id).not.toBe(userInB?.id);
  });

  it("rejects malformed emails before touching the database", async () => {
    const { ctx, org } = await makeOrg(5);
    const before = await prisma.user.count({ where: { org_id: org.id } });
    const res = await inviteLearnerForOrg(
      ctx,
      { email: "not-an-email" },
      makeOptions(),
    );
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.reason).toBe("invalid_email");
    const after = await prisma.user.count({ where: { org_id: org.id } });
    expect(after).toBe(before);
  });

  it("refuses to treat a same-org non-learner as an existing roster learner", async () => {
    const { ctx, admin } = await makeOrg(5);
    const res = await inviteLearnerForOrg(
      ctx,
      { email: admin.email },
      makeOptions(),
    );
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.reason).toBe("cannot_invite");
  });
});

// ─── Clerk-side behaviour ───────────────────────────────────────────────

describe("inviteLearnerForOrg — Clerk integration", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("treats a 422 duplicate_record from Clerk as success (idempotent re-invite)", async () => {
    const { ctx, org } = await makeOrg(5);
    const dup = makeClerkError({ status: 422, code: "duplicate_record" });
    const { client, calls } = makeFakeClerk({ behaviours: [dup] });

    const res = await inviteLearnerForOrg(
      ctx,
      { email: "already@example.com" },
      makeOptions({ clerkClient: client }),
    );

    expect(res.ok).toBe(true);
    expect(calls).toHaveLength(1);

    // DB row + ActivityLog should both exist — the duplicate is a Clerk
    // detail, not a reason to leave the org without a roster row.
    const user = await prisma.user.findFirst({
      where: { email: "already@example.com", org_id: ctx.org_id },
    });
    expect(user).not.toBeNull();
    expect(user?.org_id).toBe(org.id);
    const log = await prisma.activityLog.findFirst({
      where: { org_id: org.id, action: "learner.invited" },
    });
    expect(log).not.toBeNull();
  });

  it("retries once on 429 and succeeds on the second attempt", async () => {
    const { ctx, org } = await makeOrg(5);
    const rate = makeClerkError({ status: 429, code: "rate_limit_exceeded" });
    const { client, calls } = makeFakeClerk({ behaviours: [rate, "ok"] });
    const sleeps: number[] = [];

    const res = await inviteLearnerForOrg(
      ctx,
      { email: "slow@example.com" },
      makeOptions({
        clerkClient: client,
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      }),
    );

    expect(res.ok).toBe(true);
    expect(calls).toHaveLength(2);
    expect(sleeps).toEqual([2000]);

    const user = await prisma.user.findFirst({
      where: { email: "slow@example.com", org_id: ctx.org_id },
    });
    expect(user).not.toBeNull();
    const log = await prisma.activityLog.findFirst({
      where: { org_id: org.id, action: "learner.invited" },
    });
    expect(log).not.toBeNull();
  });

  it("surfaces clerk_rate_limited when both attempts return 429 and rolls back the DB row", async () => {
    const { ctx, org } = await makeOrg(5);
    const rate = makeClerkError({ status: 429, code: "rate_limit_exceeded" });
    const { client, calls } = makeFakeClerk({ behaviours: [rate, rate] });

    const res = await inviteLearnerForOrg(
      ctx,
      { email: "blocked@example.com" },
      makeOptions({ clerkClient: client }),
    );

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.reason).toBe("clerk_rate_limited");
    expect(calls).toHaveLength(2);

    // Rollback: DB row must be gone and no ActivityLog written.
    const user = await prisma.user.findFirst({
      where: { email: "blocked@example.com", org_id: ctx.org_id },
    });
    expect(user).toBeNull();
    const log = await prisma.activityLog.findFirst({
      where: { org_id: org.id, action: "learner.invited" },
    });
    expect(log).toBeNull();
  });

  it("rolls back the DB row and returns cannot_invite on a Clerk 5xx", async () => {
    const { ctx, org } = await makeOrg(5);
    const boom = makeClerkError({ status: 503, code: "service_unavailable" });
    const { client } = makeFakeClerk({ behaviours: [boom] });

    const res = await inviteLearnerForOrg(
      ctx,
      { email: "boom@example.com" },
      makeOptions({ clerkClient: client }),
    );

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.reason).toBe("cannot_invite");

    const user = await prisma.user.findFirst({
      where: { email: "boom@example.com", org_id: ctx.org_id },
    });
    expect(user).toBeNull();
    const log = await prisma.activityLog.findFirst({
      where: { org_id: org.id, action: "learner.invited" },
    });
    expect(log).toBeNull();

    // The org's other rows must stay intact — rollback affects only the
    // failed row, not the admin or any prior learners.
    const orgUsers = await prisma.user.count({ where: { org_id: org.id } });
    expect(orgUsers).toBe(1); // just the admin from makeOrg
  });

  it("throws InviteEnvError when APP_URL is missing and no override is supplied", async () => {
    const { ctx } = await makeOrg(5);
    const { client } = makeFakeClerk();
    // Deliberately omit appUrl AND scrub env so the guard fires.
    const previous = process.env.APP_URL;
    delete process.env.APP_URL;
    try {
      await expect(
        inviteLearnerForOrg(
          ctx,
          { email: "no-url@example.com" },
          { clerkClient: client, sleep: async () => {} },
        ),
      ).rejects.toBeInstanceOf(InviteEnvError);
    } finally {
      if (previous !== undefined) process.env.APP_URL = previous;
    }
  });
});

// ─── CSV path passes options through to each row ────────────────────────

describe("inviteLearnersFromCsvForOrg", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("splits a 30-row CSV against a 25-seat org into 25 invited + 5 failed(seat_limit_reached)", async () => {
    const { ctx } = await makeOrg(25);
    const lines = ["email,name"];
    for (let i = 1; i <= 30; i++) lines.push(`u${i}@example.com,U${i}`);
    const res = await inviteLearnersFromCsvForOrg(
      ctx,
      lines.join("\n"),
      makeOptions(),
    );
    expect(res.invited).toBe(25);
    expect(res.skipped).toBe(0);
    expect(res.failed).toHaveLength(5);
    expect(res.failed.every((f) => f.reason === "seat_limit_reached")).toBe(
      true,
    );
  });

  it("counts re-invited rows as skipped, not invited", async () => {
    const { ctx } = await makeOrg(10);
    await inviteLearnerForOrg(
      ctx,
      { email: "already@example.com" },
      makeOptions(),
    );
    const res = await inviteLearnersFromCsvForOrg(
      ctx,
      "already@example.com,Already\nfresh@example.com,Fresh",
      makeOptions(),
    );
    expect(res.invited).toBe(1);
    expect(res.skipped).toBe(1);
    expect(res.failed).toHaveLength(0);
  });
});
