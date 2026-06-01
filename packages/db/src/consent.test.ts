import { beforeEach, describe, expect, it } from "vitest";
import {
  getMyConsents,
  hasGrantedConsent,
  recordConsent,
  recordConsents,
} from "./consent";
import { withOrg, type OrgContext } from "./tenancy";
import { createTestOrg, resetDatabase, type TestOrg } from "./test-helpers";

beforeEach(async () => {
  await resetDatabase();
});

function learnerCtx(org: TestOrg): OrgContext {
  return { org_id: org.id, user_id: org.learnerIds[0]!, role: "Learner" };
}

describe("consent ledger", () => {
  it("records a consent and reads it back as the latest state", async () => {
    const org = await createTestOrg("A");
    const ctx = learnerCtx(org);

    await recordConsent(ctx, {
      consent_type: "terms_privacy",
      granted: true,
      policy_version: "privacy@2026-06-01",
      source: "signup",
    });

    expect(await hasGrantedConsent(ctx, "terms_privacy")).toBe(true);
    const latest = await getMyConsents(ctx);
    expect(latest.terms_privacy?.granted).toBe(true);
    expect(latest.terms_privacy?.policy_version).toBe("privacy@2026-06-01");
  });

  it("treats the most recent row per type as authoritative", async () => {
    const org = await createTestOrg("A");
    const ctx = learnerCtx(org);

    await recordConsent(ctx, {
      consent_type: "cookies_analytics",
      granted: true,
      policy_version: "cookies@2026-06-01",
      source: "cookie_banner",
    });
    await recordConsent(ctx, {
      consent_type: "cookies_analytics",
      granted: false,
      policy_version: "cookies@2026-06-01",
      source: "profile",
    });

    expect(await hasGrantedConsent(ctx, "cookies_analytics")).toBe(false);
    const latest = await getMyConsents(ctx);
    expect(latest.cookies_analytics?.granted).toBe(false);
    expect(latest.cookies_analytics?.source).toBe("profile");
  });

  it("records a batch snapshot atomically", async () => {
    const org = await createTestOrg("A");
    const ctx = learnerCtx(org);

    const count = await recordConsents(ctx, [
      { consent_type: "terms_privacy", granted: true, policy_version: "v1", source: "signup" },
      { consent_type: "cookies_analytics", granted: false, policy_version: "v1", source: "signup" },
      { consent_type: "marketing_email", granted: true, policy_version: "v1", source: "signup" },
    ]);

    expect(count).toBe(3);
    const latest = await getMyConsents(ctx);
    expect(Object.keys(latest).sort()).toEqual([
      "cookies_analytics",
      "marketing_email",
      "terms_privacy",
    ]);
  });

  it("never reads another org's consent rows", async () => {
    const orgA = await createTestOrg("A");
    const orgB = await createTestOrg("B");
    const ctxB = learnerCtx(orgB);
    await recordConsent(ctxB, {
      consent_type: "terms_privacy",
      granted: true,
      policy_version: "v1",
      source: "signup",
    });

    // Org A's scoped client must see zero of org B's consent rows.
    const dbA = withOrg(learnerCtx(orgA));
    const leak = await dbA.consentRecord.findMany();
    expect(leak).toHaveLength(0);
  });
});
