// GET /api/me/export — download a complete, machine-readable copy of the
// caller's own data (GDPR Art 15 + 20, APP 12, DPDP §11, regional PDPAs).
//
// Tenancy: buildUserDataExport() reads exclusively through withOrg(ctx) pinned
// to ctx.user_id, so the bundle can only ever contain the caller's own data
// from their own org. Recording metadata is included but never the raw R2 key.
//
// Also logs the access as a fulfilled "Access" data-rights request so there is
// an audit trail that the right was exercised.

import { buildUserDataExport, createDataRightsRequest } from "@elc/db";
import {
  NoOrgMembershipError,
  OrgSuspendedError,
  UnauthenticatedError,
  requireOrgContext,
} from "@/lib/auth/context";

export const dynamic = "force-dynamic";

export async function GET() {
  let ctx;
  try {
    ctx = await requireOrgContext();
  } catch (err) {
    if (
      err instanceof UnauthenticatedError ||
      err instanceof NoOrgMembershipError ||
      err instanceof OrgSuspendedError
    ) {
      return new Response("Unauthorized", { status: 401 });
    }
    throw err;
  }

  const bundle = await buildUserDataExport(ctx);
  // Record the access request (best-effort — never block the download).
  try {
    await createDataRightsRequest(ctx, { type: "Access", detail: "self-service export" });
  } catch {
    // ignore
  }

  const filename = `elanguagecenter-data-export-${new Date().toISOString().slice(0, 10)}.json`;
  return new Response(JSON.stringify(bundle, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
