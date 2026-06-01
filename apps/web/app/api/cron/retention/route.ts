// GET /api/cron/retention — scheduled data-retention maintenance (ADR-0019).
//
// Runs daily (see vercel.json). Two jobs:
//   1. Purge Speaking recordings past the 90-day retention window.
//   2. Action queued erasure requests whose 24h cancellation window elapsed.
//
// Auth: a shared CRON_SECRET bearer token. Vercel Cron sends it via the
// Authorization header when configured. We refuse anything else so the
// endpoint can't be triggered by the public. This is a SYSTEM job — it uses
// the raw helpers in @elc/db/retention (neither withOrg nor SuperAdmin), and
// deletes R2 objects through @elc/storage's deleteObject.

import { NextResponse } from "next/server";
import { processPendingErasures, purgeExpiredRecordings } from "@elc/db";
import { deleteObject } from "@elc/storage";

export const dynamic = "force-dynamic";
// Retention work can run long on a large estate; give it headroom.
export const maxDuration = 300;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization");
  return header === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const recordings = await purgeExpiredRecordings({ deleteObject });
  const erasures = await processPendingErasures({ deleteObject });

  return NextResponse.json({
    ok: true,
    ran_at: new Date().toISOString(),
    recordings,
    erasures,
  });
}
