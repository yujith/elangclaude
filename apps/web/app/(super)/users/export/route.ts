// /users/export — SuperAdmin-only CSV download mirroring the filters on
// /users. Capped at 5000 rows so a curious click against a large tenant
// base doesn't pull 100k+ rows into memory; the page's own pagination
// hint nudges the SuperAdmin to narrow filters if they hit the ceiling.
//
// Route Handlers in App Router can't redirect or set cookies the way a
// server action can, but they can stream text with Content-Disposition,
// which is exactly what we want for "Download CSV". Auth is the same
// requireRole("SuperAdmin") used by every (super) surface.

import { NextResponse } from "next/server";
import {
  SYSTEM_ORG_ID,
  withSuperAdminContext,
  type Role,
} from "@elc/db";
import { requireRole } from "@/lib/auth/context";

export const dynamic = "force-dynamic";

const ROLES: readonly Role[] = ["SuperAdmin", "OrgAdmin", "Learner"];
type StatusFilter = "active" | "removed" | "all";
const STATUSES: readonly StatusFilter[] = ["active", "removed", "all"];

const ROW_CAP = 5000;

function parseRole(raw: string | null): Role | null {
  return raw && ROLES.includes(raw as Role) ? (raw as Role) : null;
}

function parseStatus(raw: string | null): StatusFilter {
  return raw && STATUSES.includes(raw as StatusFilter)
    ? (raw as StatusFilter)
    : "active";
}

function normalizeQuery(raw: string | null): string | null {
  if (raw === null) return null;
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, 200);
}

// RFC 4180-ish: wrap fields containing comma, quote, or newline in
// double quotes; double any embedded quotes. Always-quote keeps the
// output diff-friendly when columns shift.
function csvField(value: string | null | undefined): string {
  const s = value ?? "";
  return `"${s.replace(/"/g, '""')}"`;
}

function isoOrEmpty(d: Date | null | undefined): string {
  return d ? d.toISOString() : "";
}

export async function GET(request: Request): Promise<Response> {
  const ctx = await requireRole("SuperAdmin");
  const db = withSuperAdminContext(ctx);
  const url = new URL(request.url);

  const q = normalizeQuery(url.searchParams.get("q"));
  const orgParam = url.searchParams.get("org");
  const orgFilter =
    orgParam && orgParam.length > 0 && orgParam !== SYSTEM_ORG_ID
      ? orgParam
      : null;
  const roleFilter = parseRole(url.searchParams.get("role"));
  const statusFilter = parseStatus(url.searchParams.get("status"));

  // Same shape as /users/page.tsx — keep the two queries in lockstep.
  // org_id is pinned to the filtered org when present, otherwise we
  // exclude the system org. Single explicit clause rather than a
  // spread-overwrite (orgFilter is already sanitised above to refuse
  // SYSTEM_ORG_ID).
  const where = {
    org_id: orgFilter ?? { not: SYSTEM_ORG_ID },
    ...(roleFilter ? { role: roleFilter } : {}),
    ...(statusFilter === "active" ? { deleted_at: null } : {}),
    ...(statusFilter === "removed" ? { deleted_at: { not: null } } : {}),
    ...(q
      ? {
          OR: [
            { email: { contains: q, mode: "insensitive" as const } },
            { name: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const users = await db.user.findMany({
    where,
    orderBy: [{ org: { name: "asc" } }, { role: "asc" }, { email: "asc" }],
    take: ROW_CAP + 1,
    select: {
      email: true,
      name: true,
      role: true,
      deleted_at: true,
      createdAt: true,
      org: { select: { name: true, status: true } },
    },
  });

  const truncated = users.length > ROW_CAP;
  const rows = truncated ? users.slice(0, ROW_CAP) : users;

  const header = [
    "email",
    "name",
    "role",
    "organisation",
    "org_status",
    "status",
    "removed_at",
    "created_at",
  ];
  const lines: string[] = [header.join(",")];
  for (const u of rows) {
    lines.push(
      [
        csvField(u.email),
        csvField(u.name),
        csvField(u.role),
        csvField(u.org.name),
        csvField(u.org.status),
        csvField(u.deleted_at ? "Removed" : "Active"),
        csvField(isoOrEmpty(u.deleted_at)),
        csvField(isoOrEmpty(u.createdAt)),
      ].join(","),
    );
  }
  if (truncated) {
    // Last-line marker (still a valid CSV row) so a downstream pipeline
    // can detect that the export was capped without re-querying.
    lines.push(
      ["# TRUNCATED", "", "", "", "", "", "", `at ${ROW_CAP} rows`]
        .map((v) => csvField(v))
        .join(","),
    );
  }

  // Excel and Numbers both honour the UTF-8 BOM as an encoding hint.
  const body = "﻿" + lines.join("\r\n") + "\r\n";
  const dateStamp = new Date().toISOString().slice(0, 10);

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="users-${dateStamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
