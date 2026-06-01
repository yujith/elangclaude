import { beforeEach, describe, expect, it } from "vitest";
import {
  buildUserDataExport,
  cancelErasure,
  createDataRightsRequest,
  listMyDataRightsRequests,
  rectifyMyName,
  requestErasure,
} from "./data-rights";
import { recordConsent } from "./consent";
import { type OrgContext } from "./tenancy";
import {
  createTestOrg,
  resetDatabase,
  seedActivity,
  type TestOrg,
} from "./test-helpers";

beforeEach(async () => {
  await resetDatabase();
});

function learnerCtx(org: TestOrg, idx = 0): OrgContext {
  return { org_id: org.id, user_id: org.learnerIds[idx]!, role: "Learner" };
}

describe("data export", () => {
  it("bundles the caller's profile, consents, attempts, and requests", async () => {
    const org = await createTestOrg("A");
    await seedActivity(org, 2); // attempts for every learner
    const ctx = learnerCtx(org);

    await recordConsent(ctx, {
      consent_type: "terms_privacy",
      granted: true,
      policy_version: "v1",
      source: "signup",
    });
    await createDataRightsRequest(ctx, { type: "Access" });

    const bundle = await buildUserDataExport(ctx);

    expect(bundle.subject.id).toBe(ctx.user_id);
    expect(bundle.organization.id).toBe(org.id);
    expect(bundle.consents).toHaveLength(1);
    expect(bundle.attempts.length).toBe(2);
    expect(bundle.data_rights_requests.some((r) => r.type === "Access")).toBe(true);
    // Recording metadata must never expose a raw storage key.
    expect(JSON.stringify(bundle)).not.toContain("storage_url");
  });

  it("only exports the caller's own attempts, not other learners' in the same org", async () => {
    const org = await createTestOrg("A");
    await seedActivity(org, 3);
    const ctx = learnerCtx(org, 0);

    const bundle = await buildUserDataExport(ctx);
    // 3 learners × 3 attempts exist in the org; the caller gets only their 3.
    expect(bundle.attempts).toHaveLength(3);
  });

  it("cannot export across orgs", async () => {
    const orgA = await createTestOrg("A");
    const orgB = await createTestOrg("B");
    await seedActivity(orgB, 2);
    // A learner ctx pointing at org A but with org B's learner id must not
    // resolve a user (withOrg pins org_id = A, so the B user isn't found).
    const crossCtx: OrgContext = {
      org_id: orgA.id,
      user_id: orgB.learnerIds[0]!,
      role: "Learner",
    };
    await expect(buildUserDataExport(crossCtx)).rejects.toThrow();
  });
});

describe("data rights requests", () => {
  it("requestErasure is idempotent while Pending", async () => {
    const org = await createTestOrg("A");
    const ctx = learnerCtx(org);

    const first = await requestErasure(ctx, { detail: "delete me" });
    const second = await requestErasure(ctx);

    expect(first.alreadyPending).toBe(false);
    expect(second.alreadyPending).toBe(true);
    expect(second.id).toBe(first.id);

    const requests = await listMyDataRightsRequests(ctx);
    expect(requests.filter((r) => r.type === "Erasure")).toHaveLength(1);
  });

  it("cancelErasure flips a Pending erasure to Cancelled", async () => {
    const org = await createTestOrg("A");
    const ctx = learnerCtx(org);
    await requestErasure(ctx);

    const cancelled = await cancelErasure(ctx);
    expect(cancelled).toBe(1);

    const requests = await listMyDataRightsRequests(ctx);
    expect(requests[0]?.status).toBe("Cancelled");
  });

  it("rectifyMyName updates the display name and rejects empty", async () => {
    const org = await createTestOrg("A");
    const ctx = learnerCtx(org);

    expect((await rectifyMyName(ctx, "  ")).ok).toBe(false);
    expect((await rectifyMyName(ctx, "Jaya Perera")).ok).toBe(true);

    const bundle = await buildUserDataExport(ctx);
    expect(bundle.subject.name).toBe("Jaya Perera");
  });
});
