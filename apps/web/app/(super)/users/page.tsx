import type { Metadata } from "next";
import Link from "next/link";
import {
  SYSTEM_ORG_ID,
  withSuperAdminContext,
  type Role,
} from "@elc/db";
import { requireRole } from "@/lib/auth/context";

export const metadata: Metadata = {
  title: "Users · SuperAdmin",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

const ROLES: readonly Role[] = ["SuperAdmin", "OrgAdmin", "Learner"];
type StatusFilter = "active" | "removed" | "all";
const STATUSES: readonly StatusFilter[] = ["active", "removed", "all"];

type SearchParams = {
  q?: string;
  org?: string;
  role?: string;
  status?: string;
};

function parseRole(raw: unknown): Role | null {
  return ROLES.includes(raw as Role) ? (raw as Role) : null;
}

function parseStatus(raw: unknown): StatusFilter {
  return STATUSES.includes(raw as StatusFilter)
    ? (raw as StatusFilter)
    : "active";
}

function normalizeQuery(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.length === 0) return null;
  // Clamp to avoid pathological queries from URL tampering.
  return trimmed.slice(0, 200);
}

function roleBadgeClasses(role: Role): string {
  if (role === "SuperAdmin") return "bg-brand-red text-white";
  if (role === "OrgAdmin") return "bg-brand-black text-white";
  return "bg-brand-grey-200 text-brand-grey-700";
}

function buildHref(
  current: {
    q: string | null;
    org: string | null;
    role: Role | null;
    status: StatusFilter;
  },
  patch: Partial<{
    q: string | null;
    org: string | null;
    role: Role | null;
    status: StatusFilter;
  }>,
): string {
  const next = { ...current, ...patch };
  const params = new URLSearchParams();
  if (next.q) params.set("q", next.q);
  if (next.org) params.set("org", next.org);
  if (next.role) params.set("role", next.role);
  if (next.status && next.status !== "active") params.set("status", next.status);
  const qs = params.toString();
  return qs ? `/users?${qs}` : "/users";
}

function buildExportHref(current: {
  q: string | null;
  org: string | null;
  role: Role | null;
  status: StatusFilter;
}): string {
  const params = new URLSearchParams();
  if (current.q) params.set("q", current.q);
  if (current.org) params.set("org", current.org);
  if (current.role) params.set("role", current.role);
  if (current.status && current.status !== "active") {
    params.set("status", current.status);
  }
  const qs = params.toString();
  return qs ? `/users/export?${qs}` : "/users/export";
}

export default async function GlobalUsersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const ctx = await requireRole("SuperAdmin");
  const db = withSuperAdminContext(ctx);
  const sp = await searchParams;

  const q = normalizeQuery(sp.q);
  const orgFilter =
    typeof sp.org === "string" && sp.org.length > 0 && sp.org !== SYSTEM_ORG_ID
      ? sp.org
      : null;
  const roleFilter = parseRole(sp.role);
  const statusFilter = parseStatus(sp.status);

  // Single explicit org_id filter — pinning the org when filtered, or
  // "not system" otherwise. Avoids a subtle spread-overwrite where a
  // later `org_id: orgFilter` would silently replace the system guard
  // (orgFilter is already sanitised on line 106 to refuse SYSTEM_ORG_ID,
  // but writing the intent out makes the next reviewer's life easier).
  const baseWhere = {
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

  const [users, totalActive, totalOrgAdmins, totalLearners, totalRemoved, orgs] =
    await Promise.all([
      db.user.findMany({
        where: baseWhere,
        orderBy: [{ role: "asc" }, { email: "asc" }],
        take: PAGE_SIZE,
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          deleted_at: true,
          createdAt: true,
          org: { select: { id: true, name: true, status: true } },
        },
      }),
      db.user.count({
        where: { org_id: { not: SYSTEM_ORG_ID }, deleted_at: null },
      }),
      db.user.count({
        where: {
          org_id: { not: SYSTEM_ORG_ID },
          role: "OrgAdmin",
          deleted_at: null,
        },
      }),
      db.user.count({
        where: {
          org_id: { not: SYSTEM_ORG_ID },
          role: "Learner",
          deleted_at: null,
        },
      }),
      db.user.count({
        where: { org_id: { not: SYSTEM_ORG_ID }, deleted_at: { not: null } },
      }),
      db.organization.findMany({
        where: { id: { not: SYSTEM_ORG_ID } },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
    ]);

  const current = {
    q,
    org: orgFilter,
    role: roleFilter,
    status: statusFilter,
  };
  const filteredCount = users.length;
  const hasMore = filteredCount === PAGE_SIZE;

  return (
    <section className="px-6 py-12 md:py-16">
      <div className="mx-auto max-w-6xl space-y-10">
        <header>
          <p className="font-body text-sm uppercase tracking-widest text-brand-red">
            SuperAdmin
          </p>
          <h1 className="mt-2 font-display italic font-bold text-4xl md:text-5xl text-brand-black leading-tight">
            Users.
          </h1>
          <p className="mt-3 font-body text-base text-brand-grey-700 max-w-2xl">
            Every user on the platform. Use this to find an account across
            organisations &mdash; per-user controls (promote / demote / reset
            quota / remove) live on the organisation&rsquo;s user page.
          </p>
        </header>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Stat label="Active users" value={totalActive} />
          <Stat label="OrgAdmins" value={totalOrgAdmins} />
          <Stat label="Learners" value={totalLearners} />
          <Stat label="Removed" value={totalRemoved} />
        </div>

        <section className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 p-5 space-y-4">
          <form action="/users" method="get" className="flex flex-wrap items-end gap-3">
            {/* preserve current filters across a fresh search */}
            {orgFilter ? (
              <input type="hidden" name="org" value={orgFilter} />
            ) : null}
            {roleFilter ? (
              <input type="hidden" name="role" value={roleFilter} />
            ) : null}
            {statusFilter !== "active" ? (
              <input type="hidden" name="status" value={statusFilter} />
            ) : null}
            <div className="flex-1 min-w-[16rem]">
              <label
                htmlFor="q"
                className="block font-heading font-bold text-xs uppercase tracking-wide text-brand-grey-600 mb-1"
              >
                Search email or name
              </label>
              <input
                id="q"
                name="q"
                type="search"
                defaultValue={q ?? ""}
                placeholder="e.g. admin-a or @migration"
                className="w-full rounded-md ring-1 ring-brand-grey-300 bg-white px-3 py-2 font-body text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red"
              />
            </div>
            <button
              type="submit"
              className="inline-flex items-center rounded-pill bg-brand-red px-5 py-2.5 font-heading font-bold text-white border border-brand-red transition-colors hover:bg-brand-red-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2"
            >
              Search
            </button>
            {q ? (
              <Link
                href={buildHref(current, { q: null })}
                className="font-body text-sm text-brand-grey-700 hover:text-brand-black underline-offset-4 hover:underline"
              >
                Clear search
              </Link>
            ) : null}
          </form>

          <div className="flex flex-wrap items-center gap-2">
            <span className="font-heading font-bold text-xs uppercase tracking-wide text-brand-grey-600">
              Org
            </span>
            <FilterChip
              label="Any org"
              active={orgFilter === null}
              href={buildHref(current, { org: null })}
            />
            {orgs.map((o) => (
              <FilterChip
                key={o.id}
                label={o.name}
                active={orgFilter === o.id}
                href={buildHref(current, {
                  org: orgFilter === o.id ? null : o.id,
                })}
              />
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="font-heading font-bold text-xs uppercase tracking-wide text-brand-grey-600">
              Role
            </span>
            <FilterChip
              label="Any role"
              active={roleFilter === null}
              href={buildHref(current, { role: null })}
            />
            {ROLES.map((r) => (
              <FilterChip
                key={r}
                label={r}
                active={roleFilter === r}
                href={buildHref(current, {
                  role: roleFilter === r ? null : r,
                })}
              />
            ))}
            <span className="mx-2 text-brand-grey-300">|</span>
            <span className="font-heading font-bold text-xs uppercase tracking-wide text-brand-grey-600">
              Status
            </span>
            <FilterChip
              label="Active"
              active={statusFilter === "active"}
              href={buildHref(current, { status: "active" })}
            />
            <FilterChip
              label="Removed"
              active={statusFilter === "removed"}
              href={buildHref(current, { status: "removed" })}
            />
            <FilterChip
              label="All"
              active={statusFilter === "all"}
              href={buildHref(current, { status: "all" })}
            />
            {q || orgFilter || roleFilter || statusFilter !== "active" ? (
              <Link
                href="/users"
                className="ml-auto font-body text-sm text-brand-grey-700 hover:text-brand-black underline-offset-4 hover:underline"
              >
                Clear filters
              </Link>
            ) : null}
          </div>
        </section>

        <section>
          <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
            <h2 className="font-heading font-bold text-xl text-brand-black">
              Results ({filteredCount}
              {hasMore ? "+" : ""})
            </h2>
            <a
              href={buildExportHref(current)}
              className="inline-flex items-center rounded-pill border border-brand-grey-300 bg-brand-white px-4 py-1.5 font-heading font-bold text-xs text-brand-black hover:bg-brand-grey-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 transition-colors"
              // Plain anchor (not Link) so the browser handles the
              // Content-Disposition attachment correctly.
            >
              Download CSV ↓
            </a>
          </div>
          <div className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 overflow-hidden">
            {filteredCount === 0 ? (
              <p className="px-6 py-8 font-body text-base text-brand-grey-700">
                No users match those filters.
              </p>
            ) : (
              <table className="w-full text-left">
                <thead className="bg-brand-grey-50">
                  <tr>
                    <Th>Email</Th>
                    <Th>Name</Th>
                    <Th>Role</Th>
                    <Th>Organisation</Th>
                    <Th>Status</Th>
                    <Th>{""}</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-grey-200">
                  {users.map((u) => {
                    const removed = u.deleted_at !== null;
                    return (
                      <tr key={u.id} className={removed ? "bg-brand-grey-50/60" : ""}>
                        <Td>
                          <span
                            className={`font-body text-sm ${
                              removed
                                ? "text-brand-grey-500 line-through"
                                : "text-brand-black"
                            }`}
                          >
                            {u.email}
                          </span>
                        </Td>
                        <Td>
                          <span className="font-body text-sm text-brand-grey-700">
                            {u.name ?? "—"}
                          </span>
                        </Td>
                        <Td>
                          <span
                            className={`inline-flex items-center rounded-pill px-2.5 py-1 font-heading font-bold text-xs ${roleBadgeClasses(u.role)}`}
                          >
                            {u.role}
                          </span>
                        </Td>
                        <Td>
                          <Link
                            href={`/orgs/${u.org.id}`}
                            className="font-body text-sm text-brand-black hover:text-brand-red underline-offset-4 hover:underline"
                          >
                            {u.org.name}
                          </Link>
                          {u.org.status !== "Active" ? (
                            <span className="ml-2 font-body text-xs uppercase tracking-wide text-brand-grey-500">
                              {u.org.status}
                            </span>
                          ) : null}
                        </Td>
                        <Td>
                          {removed ? (
                            <span className="font-body text-xs uppercase tracking-wide text-brand-grey-500">
                              Removed
                            </span>
                          ) : (
                            <span className="font-body text-xs uppercase tracking-wide text-brand-grey-500">
                              Active
                            </span>
                          )}
                        </Td>
                        <Td>
                          <Link
                            href={`/orgs/${u.org.id}/users?focus=${u.id}#user-${u.id}`}
                            className="font-body text-sm text-brand-black hover:text-brand-red underline-offset-4 hover:underline"
                          >
                            Manage →
                          </Link>
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          {hasMore ? (
            <p className="mt-3 font-body text-xs text-brand-grey-500">
              Showing the first {PAGE_SIZE} matches. Narrow with the search box
              or filters above.
            </p>
          ) : null}
        </section>
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 p-5">
      <p className="font-body text-xs uppercase tracking-widest text-brand-grey-500">
        {label}
      </p>
      <p className="mt-1 font-display italic font-bold text-3xl text-brand-black leading-none">
        {value}
      </p>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-6 py-3 font-body text-xs uppercase tracking-widest text-brand-grey-500">
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-6 py-3 align-middle">{children}</td>;
}

function FilterChip({
  label,
  active,
  href,
}: {
  label: string;
  active: boolean;
  href: string;
}) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center rounded-pill px-3 py-1.5 font-heading font-bold text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 ${
        active
          ? "bg-brand-black text-white"
          : "bg-brand-white text-brand-grey-700 border border-brand-grey-300 hover:bg-brand-grey-50"
      }`}
    >
      {label}
    </Link>
  );
}
