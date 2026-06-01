// POST /api/consent — persist an authenticated user's cookie choice to the
// consent ledger. Anonymous visitors are a no-op (their choice lives in the
// first-party cookie only); we never write an org-less consent row. The body
// mirrors the ConsentChoice the banner stores client-side.
//
// Tenancy: recordConsents() goes through withOrg(ctx), so a row can only be
// attributed to the authenticated caller inside their own org.

import { NextResponse } from "next/server";
import { recordConsents } from "@elc/db";
import { tryGetOrgContext } from "@/lib/auth/context";
import { hashIp } from "@/lib/consent/ip-hash";
import { cookiesVersion } from "@/lib/legal/policies";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const ctx = await tryGetOrgContext();
  // Anonymous visitor: nothing to persist server-side.
  if (!ctx) return new NextResponse(null, { status: 204 });

  let body: { functional?: unknown; analytics?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const functional = body.functional === true;
  const analytics = body.analytics === true;
  const version = cookiesVersion();
  const ip_hash = hashIp(request.headers.get("x-forwarded-for"));
  const user_agent = request.headers.get("user-agent");

  await recordConsents(ctx, [
    {
      consent_type: "cookies_functional",
      granted: functional,
      policy_version: version,
      source: "cookie_banner",
      ip_hash,
      user_agent,
    },
    {
      consent_type: "cookies_analytics",
      granted: analytics,
      policy_version: version,
      source: "cookie_banner",
      ip_hash,
      user_agent,
    },
  ]);

  return new NextResponse(null, { status: 204 });
}
