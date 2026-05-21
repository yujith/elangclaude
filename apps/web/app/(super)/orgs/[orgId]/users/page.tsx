import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SYSTEM_ORG_ID, withSuperAdminContext, type Role } from "@elc/db";
import { requireRole } from "@/lib/auth/context";
import {
  inviteOrgAdminFromForm,
  resetUserQuotaFromForm,
  setUserRoleFromForm,
  softDeleteUserFromForm,
} from "@/lib/super/user-actions";

export const metadata: Metadata = {
  title: "Organisation users · SuperAdmin",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type SearchParams = {
  invited?: string;
  existing?: string;
  role_changed?: string;
  quota_reset?: string;
  removed?: string;
  show_removed?: string;
  focus?: string;
  error?: string;
};

const ERROR_COPY: Record<string, string> = {
  invalid_email: "That email address is not valid.",
  cannot_invite:
    "That email cannot be invited (in use elsewhere, or previously removed from this org).",
  org_not_found: "Organisation not found.",
  user_not_found: "User not found.",
  user_deleted: "That user has been removed.",
  invalid_role: "That role cannot be assigned here.",
  cannot_change_super_admin: "SuperAdmin accounts cannot be edited here.",
  last_admin:
    "Cannot remove or demote the last active OrgAdmin. Promote another user first.",
  org_mismatch:
    "That user no longer belongs to this organisation. Refresh the page and try again.",
};

function statusBadgeClasses(status: "Active" | "Suspended" | "Archived") {
  if (status === "Active") return "bg-brand-black text-white";
  if (status === "Suspended") {
    return "bg-brand-red-soft text-brand-grey-900 ring-1 ring-brand-red/40";
  }
  return "bg-brand-grey-200 text-brand-grey-700";
}

function roleBadgeClasses(role: Role) {
  if (role === "SuperAdmin") {
    return "bg-brand-red text-white";
  }
  if (role === "OrgAdmin") return "bg-brand-black text-white";
  return "bg-brand-grey-200 text-brand-grey-700";
}

function startOfUtcToday(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

export default async function OrgUsersPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const ctx = await requireRole("SuperAdmin");
  const { orgId } = await params;
  if (orgId === SYSTEM_ORG_ID) notFound();
  const sp = await searchParams;
  const db = withSuperAdminContext(ctx);

  const org = await db.organization.findUnique({
    where: { id: orgId },
    select: { id: true, name: true, status: true, seat_limit: true },
  });
  if (!org) notFound();

  const showRemoved = sp.show_removed === "1";
  const focusUserId =
    typeof sp.focus === "string" && sp.focus.length > 0 ? sp.focus : null;
  const today = startOfUtcToday();

  const [users, learnerCountActive, learnerCountAll, todayUsage] =
    await Promise.all([
      db.user.findMany({
        where: showRemoved ? { org_id: orgId } : { org_id: orgId, deleted_at: null },
        orderBy: [{ role: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          ielts_track: true,
          deleted_at: true,
          createdAt: true,
        },
      }),
      db.user.count({
        where: { org_id: orgId, role: "Learner", deleted_at: null },
      }),
      db.user.count({ where: { org_id: orgId, role: "Learner" } }),
      db.quotaUsage.findMany({
        where: { org_id: orgId, date: today },
        select: { user_id: true, ai_calls_count: true },
      }),
    ]);

  const usageByUser = new Map<string, number>(
    todayUsage.map((r) => [r.user_id, r.ai_calls_count]),
  );

  const errorMessage = sp.error ? ERROR_COPY[sp.error] ?? sp.error : null;

  return (
    <section className="px-6 py-12 md:py-16">
      <div className="mx-auto max-w-6xl space-y-10">
        <div>
          <Link
            href={`/orgs/${org.id}`}
            className="font-body text-sm text-brand-grey-700 hover:text-brand-black underline-offset-4 hover:underline"
          >
            ← {org.name}
          </Link>
        </div>

        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-body text-sm uppercase tracking-widest text-brand-red">
              Organisation users
            </p>
            <h1 className="mt-2 font-display italic font-bold text-4xl md:text-5xl text-brand-black leading-tight">
              {org.name}.
            </h1>
            <p className="mt-3 font-body text-base text-brand-grey-700">
              {learnerCountActive} active learners
              {org.seat_limit > 0 ? ` of ${org.seat_limit} seats` : ""}
              {learnerCountAll > learnerCountActive
                ? ` · ${learnerCountAll - learnerCountActive} removed`
                : ""}
              .
            </p>
          </div>
          <span
            className={`inline-flex items-center rounded-pill px-4 py-1.5 font-heading font-bold text-sm ${statusBadgeClasses(org.status)}`}
          >
            {org.status}
          </span>
        </header>

        {sp.invited ? (
          <Banner tone="success">
            {sp.existing
              ? "User was already in this org — role updated."
              : "OrgAdmin invited. They will appear on next sign-in."}
          </Banner>
        ) : null}
        {sp.role_changed ? <Banner tone="success">Role updated.</Banner> : null}
        {sp.quota_reset ? (
          <Banner tone="success">Today&apos;s quota reset for that user.</Banner>
        ) : null}
        {sp.removed ? (
          <Banner tone="warn">
            User removed. Their attempts and grades are preserved.
          </Banner>
        ) : null}
        {errorMessage ? <Banner tone="error">{errorMessage}</Banner> : null}

        <section className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 p-6">
          <h2 className="font-heading font-bold text-lg text-brand-black">
            Invite an OrgAdmin
          </h2>
          <p className="mt-1 font-body text-sm text-brand-grey-700">
            Use this for the customer&rsquo;s primary admin. OrgAdmins manage
            learners, view activity, and configure org settings.
          </p>
          <form
            action={inviteOrgAdminFromForm}
            className="mt-5 grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-4 items-end"
          >
            <input type="hidden" name="org_id" value={org.id} />
            <Field id="email" label="Email">
              <input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="off"
                className="w-full rounded-md ring-1 ring-brand-grey-300 bg-white px-3 py-2 font-body text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red"
              />
            </Field>
            <Field id="name" label="Name (optional)">
              <input
                id="name"
                name="name"
                type="text"
                maxLength={200}
                autoComplete="off"
                className="w-full rounded-md ring-1 ring-brand-grey-300 bg-white px-3 py-2 font-body text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red"
              />
            </Field>
            <button
              type="submit"
              className="inline-flex items-center justify-center rounded-pill bg-brand-red px-5 py-2.5 font-heading font-bold text-white border border-brand-red transition-colors hover:bg-brand-red-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2"
            >
              Invite OrgAdmin
            </button>
          </form>
        </section>

        <section>
          <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
            <h2 className="font-heading font-bold text-xl text-brand-black">
              Users ({users.length})
            </h2>
            <Link
              href={`/orgs/${org.id}/users${showRemoved ? "" : "?show_removed=1"}`}
              className="font-body text-sm text-brand-grey-700 hover:text-brand-black underline-offset-4 hover:underline"
            >
              {showRemoved ? "Hide removed" : "Show removed"}
            </Link>
          </div>
          <div className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 overflow-hidden">
            {users.length === 0 ? (
              <p className="px-6 py-8 font-body text-base text-brand-grey-700">
                No users {showRemoved ? "" : "yet"} in this organisation.
              </p>
            ) : (
              <table className="w-full text-left">
                <thead className="bg-brand-grey-50">
                  <tr>
                    <Th>Email</Th>
                    <Th>Name</Th>
                    <Th>Role</Th>
                    <Th>Calls today</Th>
                    <Th>Actions</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-grey-200">
                  {users.map((u) => {
                    const callsToday = usageByUser.get(u.id) ?? 0;
                    const removed = u.deleted_at !== null;
                    const focused = focusUserId === u.id;
                    return (
                      <tr
                        key={u.id}
                        // Anchor + ring lets /users deep-link with
                        // #user-{id} and have the browser auto-scroll
                        // here while the row stays visually highlighted.
                        id={`user-${u.id}`}
                        className={`${removed ? "bg-brand-grey-50/60" : ""} ${focused ? "ring-2 ring-brand-red ring-inset bg-brand-red-soft/40" : ""}`}
                      >
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
                          {removed ? (
                            <span className="ml-2 font-body text-xs uppercase tracking-wide text-brand-grey-500">
                              removed
                            </span>
                          ) : null}
                        </Td>
                        <Td>
                          <span className="font-body text-sm text-brand-grey-700">
                            {callsToday}
                          </span>
                        </Td>
                        <Td>
                          <UserActions
                            orgId={org.id}
                            user={u}
                            removed={removed}
                          />
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>
    </section>
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

function Field({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="block font-heading font-bold text-xs uppercase tracking-wide text-brand-grey-600 mb-1"
      >
        {label}
      </label>
      {children}
    </div>
  );
}

function UserActions({
  orgId,
  user,
  removed,
}: {
  orgId: string;
  user: {
    id: string;
    role: Role;
  };
  removed: boolean;
}) {
  if (user.role === "SuperAdmin") {
    return (
      <span className="font-body text-xs text-brand-grey-500">
        Managed centrally
      </span>
    );
  }
  if (removed) {
    return (
      <span className="font-body text-xs text-brand-grey-500">
        Soft-deleted
      </span>
    );
  }
  const toggleRole: Role = user.role === "OrgAdmin" ? "Learner" : "OrgAdmin";
  const toggleLabel =
    user.role === "OrgAdmin" ? "Demote to Learner" : "Promote to OrgAdmin";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <form action={setUserRoleFromForm}>
        <input type="hidden" name="org_id" value={orgId} />
        <input type="hidden" name="user_id" value={user.id} />
        <input type="hidden" name="role" value={toggleRole} />
        <button
          type="submit"
          className="inline-flex items-center rounded-pill border border-brand-grey-300 bg-brand-white px-3 py-1.5 font-heading font-bold text-xs text-brand-black hover:bg-brand-grey-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 transition-colors"
        >
          {toggleLabel}
        </button>
      </form>
      <form action={resetUserQuotaFromForm}>
        <input type="hidden" name="org_id" value={orgId} />
        <input type="hidden" name="user_id" value={user.id} />
        <button
          type="submit"
          className="inline-flex items-center rounded-pill border border-brand-grey-300 bg-brand-white px-3 py-1.5 font-heading font-bold text-xs text-brand-black hover:bg-brand-grey-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 transition-colors"
        >
          Reset quota
        </button>
      </form>
      <form action={softDeleteUserFromForm}>
        <input type="hidden" name="org_id" value={orgId} />
        <input type="hidden" name="user_id" value={user.id} />
        <button
          type="submit"
          className="inline-flex items-center rounded-pill border border-brand-red/60 bg-brand-red-soft px-3 py-1.5 font-heading font-bold text-xs text-brand-grey-900 hover:bg-brand-red-soft/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 transition-colors"
        >
          Remove
        </button>
      </form>
    </div>
  );
}

function Banner({
  tone,
  children,
}: {
  tone: "success" | "warn" | "error";
  children: React.ReactNode;
}) {
  const styles =
    tone === "error"
      ? "bg-brand-red-soft ring-brand-red/40 text-brand-grey-900"
      : tone === "warn"
        ? "bg-brand-grey-50 ring-brand-grey-300 text-brand-grey-900"
        : "bg-brand-white ring-brand-grey-200 text-brand-grey-900";
  return (
    <div className={`rounded-lg ring-1 px-5 py-3 ${styles}`}>
      <p className="font-body text-sm">{children}</p>
    </div>
  );
}
