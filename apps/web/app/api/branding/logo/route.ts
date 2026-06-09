// GET /api/branding/logo — 302 to a fresh 15-minute signed URL for the
// caller's org logo (ADR-0023).
//
// Tenancy: the org comes exclusively from the authenticated session ctx —
// there is no org parameter to tamper with. The signed-URL minter re-runs
// assertBrandingLogoKey against ctx.org_id, so even a corrupted DB key can
// never be signed across orgs. Signed URLs only, per the R2 rule; the short
// private cache keeps chrome renders cheap without outliving the signature.

import { getOrgBrandingSnapshot } from "@elc/db/org-branding";
import { signedBrandingLogoUrl } from "@elc/storage";
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

  const snapshot = await getOrgBrandingSnapshot(ctx);
  const key = snapshot.row?.logo_object_key;
  if (!key) return new Response("Not found", { status: 404 });

  const url = await signedBrandingLogoUrl({ key, org_id: ctx.org_id });
  return new Response(null, {
    status: 302,
    headers: {
      Location: url,
      // Private + shorter than the 15-min signature so a cached redirect
      // can never point at an expired URL.
      "Cache-Control": "private, max-age=600",
    },
  });
}
