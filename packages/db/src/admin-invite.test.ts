import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "./client";
import { resetDatabase } from "./test-helpers";
import {
  CSV_ROW_CAP,
  inviteLearnerForOrg,
  inviteLearnersFromCsvForOrg,
  parseInviteCsv,
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

describe("inviteLearnerForOrg", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("creates a Learner, sets ielts_track=Academic, writes an ActivityLog", async () => {
    const { ctx, org } = await makeOrg(5);
    const res = await inviteLearnerForOrg(ctx, {
      email: "Alice@Example.com",
      name: "Alice",
    });
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
  });

  it("is idempotent — re-inviting an existing in-org learner returns alreadyExisted", async () => {
    const { ctx } = await makeOrg(5);
    const a = await inviteLearnerForOrg(ctx, { email: "dup@example.com" });
    expect(a.ok).toBe(true);
    const b = await inviteLearnerForOrg(ctx, { email: "DUP@example.com" });
    expect(b.ok).toBe(true);
    if (!a.ok || !b.ok) throw new Error("unreachable");
    expect(b.user_id).toBe(a.user_id);
    expect(b.alreadyExisted).toBe(true);
  });

  it("blocks the (seat_limit + 1)-th invite with seat_limit_reached", async () => {
    const { ctx } = await makeOrg(3);
    for (let i = 0; i < 3; i++) {
      const r = await inviteLearnerForOrg(ctx, {
        email: `seat-${i}@example.com`,
      });
      expect(r.ok).toBe(true);
    }
    const fourth = await inviteLearnerForOrg(ctx, {
      email: "overflow@example.com",
    });
    expect(fourth.ok).toBe(false);
    if (fourth.ok) throw new Error("unreachable");
    expect(fourth.reason).toBe("seat_limit_reached");
  });

  it("refuses a cross-org email with the generic cannot_invite reason", async () => {
    const a = await makeOrg(5);
    const b = await makeOrg(5);
    const inA = await inviteLearnerForOrg(a.ctx, { email: "shared@example.com" });
    expect(inA.ok).toBe(true);
    const inB = await inviteLearnerForOrg(b.ctx, { email: "shared@example.com" });
    expect(inB.ok).toBe(false);
    if (inB.ok) throw new Error("unreachable");
    expect(inB.reason).toBe("cannot_invite");
  });

  it("rejects malformed emails before touching the database", async () => {
    const { ctx, org } = await makeOrg(5);
    const before = await prisma.user.count({ where: { org_id: org.id } });
    const res = await inviteLearnerForOrg(ctx, { email: "not-an-email" });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.reason).toBe("invalid_email");
    const after = await prisma.user.count({ where: { org_id: org.id } });
    expect(after).toBe(before);
  });
});

describe("inviteLearnersFromCsvForOrg", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("splits a 30-row CSV against a 25-seat org into 25 invited + 5 failed(seat_limit_reached)", async () => {
    const { ctx } = await makeOrg(25);
    const lines = ["email,name"];
    for (let i = 1; i <= 30; i++) lines.push(`u${i}@example.com,U${i}`);
    const res = await inviteLearnersFromCsvForOrg(ctx, lines.join("\n"));
    expect(res.invited).toBe(25);
    expect(res.skipped).toBe(0);
    expect(res.failed).toHaveLength(5);
    expect(res.failed.every((f) => f.reason === "seat_limit_reached")).toBe(
      true,
    );
  });

  it("counts re-invited rows as skipped, not invited", async () => {
    const { ctx } = await makeOrg(10);
    await inviteLearnerForOrg(ctx, { email: "already@example.com" });
    const res = await inviteLearnersFromCsvForOrg(
      ctx,
      "already@example.com,Already\nfresh@example.com,Fresh",
    );
    expect(res.invited).toBe(1);
    expect(res.skipped).toBe(1);
    expect(res.failed).toHaveLength(0);
  });
});
