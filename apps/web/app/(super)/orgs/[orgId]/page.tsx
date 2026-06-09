import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SYSTEM_ORG_ID, withSuperAdminContext } from "@elc/db";
import { BRANDING_FONTS, type BrandingFontKey } from "@elc/db/branding";
import { getBrandingForOrgAsSuperAdmin } from "@elc/db/org-branding";
import { requireRole } from "@/lib/auth/context";
import { resetOrgBrandingFromForm } from "@/lib/super/branding-actions";
import {
  setOrgStatusFromForm,
  updateOrgSettingsFromForm,
} from "@/lib/super/org-actions";
import { ConfirmSubmitButton } from "@/components/ui/confirm-submit-button";
import { SubmitButton } from "@/components/ui/submit-button";

export const metadata: Metadata = {
  title: "Organisation · SuperAdmin",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type SearchParams = {
  created?: string;
  saved?: string;
  status_changed?: string;
  branding_reset?: string;
  error?: string;
};

const ERROR_COPY: Record<string, string> = {
  name_required: "Name is required.",
  name_too_long: "Name is too long (max 200 characters).",
  seat_limit_invalid: "Seat limit must be a whole number between 0 and 100,000.",
  quota_daily_invalid: "Daily quota must be a whole non-negative number.",
  quota_monthly_invalid: "Monthly quota must be a whole non-negative number.",
  invalid_status: "That status is not valid.",
  system_org_immutable: "The system organisation cannot be edited.",
  not_found: "Organisation not found.",
};

function startOfUtcToday(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

function statusBadgeClasses(status: "Active" | "Suspended" | "Archived") {
  if (status === "Active") return "bg-brand-black text-white";
  if (status === "Suspended") {
    return "bg-brand-red-soft text-brand-grey-900 ring-1 ring-brand-red/40";
  }
  return "bg-brand-grey-200 text-brand-grey-700";
}

function formatRelative(ts: Date): string {
  const diffMs = Date.now() - ts.getTime();
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

export default async function OrgDetailPage({
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
    select: {
      id: true,
      name: true,
      status: true,
      seat_limit: true,
      quota_daily: true,
      quota_monthly: true,
      createdAt: true,
      _count: { select: { users: true } },
    },
  });
  if (!org) notFound();

  const branding = await getBrandingForOrgAsSuperAdmin(ctx, orgId);

  const [learnerCount, adminCount, quotaSum, activity] = await Promise.all([
    db.user.count({ where: { org_id: orgId, role: "Learner" } }),
    db.user.count({ where: { org_id: orgId, role: "OrgAdmin" } }),
    db.quotaUsage.aggregate({
      _sum: { ai_calls_count: true },
      where: { org_id: orgId, date: startOfUtcToday() },
    }),
    db.activityLog.findMany({
      where: { org_id: orgId },
      orderBy: { timestamp: "desc" },
      take: 10,
      select: {
        id: true,
        action: true,
        timestamp: true,
        user: { select: { name: true, email: true } },
      },
    }),
  ]);

  const aiCallsToday = quotaSum._sum.ai_calls_count ?? 0;
  const seatPct =
    org.seat_limit > 0
      ? Math.min(100, Math.round((learnerCount / org.seat_limit) * 100))
      : 0;
  const errorMessage = sp.error ? ERROR_COPY[sp.error] ?? sp.error : null;

  return (
    <section className="px-6 py-12 md:py-16">
      <div className="mx-auto max-w-5xl space-y-10">
        <div>
          <Link
            href="/orgs"
            className="font-body text-sm text-brand-grey-700 hover:text-brand-black underline-offset-4 hover:underline"
          >
            ← All organisations
          </Link>
        </div>

        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-body text-sm uppercase tracking-widest text-brand-red">
              Organisation
            </p>
            <h1 className="mt-2 font-display italic font-bold text-4xl md:text-5xl text-brand-black leading-tight">
              {org.name}.
            </h1>
            <p className="mt-3 font-body text-sm text-brand-grey-700">
              Created {org.createdAt.toISOString().slice(0, 10)} · id{" "}
              <code className="font-mono text-xs">{org.id}</code>
            </p>
          </div>
          <span
            className={`inline-flex items-center rounded-pill px-4 py-1.5 font-heading font-bold text-sm ${statusBadgeClasses(org.status)}`}
          >
            {org.status}
          </span>
        </header>

        {sp.created ? (
          <Banner tone="success">
            Organisation created. Configure settings below.
          </Banner>
        ) : null}
        {sp.saved ? <Banner tone="success">Settings saved.</Banner> : null}
        {sp.status_changed ? (
          <Banner tone="success">Status updated.</Banner>
        ) : null}
        {errorMessage ? (
          <Banner tone="error">{errorMessage}</Banner>
        ) : null}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <Stat
            label="Learners"
            value={`${learnerCount} / ${org.seat_limit || "—"}`}
            sub={
              org.seat_limit > 0
                ? `${Math.max(0, org.seat_limit - learnerCount)} seats remaining`
                : "No seat limit set."
            }
            pct={seatPct}
          />
          <Stat
            label="OrgAdmins"
            value={`${adminCount}`}
            sub={adminCount === 0 ? "No admins yet." : null}
          />
          <Stat
            label="AI calls today"
            value={`${aiCallsToday}`}
            sub={
              org.quota_daily > 0
                ? `Daily quota: ${org.quota_daily}`
                : "No daily quota."
            }
          />
        </div>

        <div>
          <Link
            href={`/orgs/${org.id}/users`}
            className="inline-flex items-center gap-2 font-heading font-bold text-sm text-brand-black hover:text-brand-red underline-offset-4 hover:underline"
          >
            Manage users →
          </Link>
        </div>

        <section className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 p-6">
          <h2 className="font-heading font-bold text-lg text-brand-black">
            Settings
          </h2>
          <p className="mt-1 font-body text-sm text-brand-grey-700">
            Name and quotas apply to all users in this organisation.
          </p>
          <form
            action={updateOrgSettingsFromForm}
            className="mt-5 space-y-5"
          >
            <input type="hidden" name="org_id" value={org.id} />
            <Field id="name" label="Organisation name">
              <input
                id="name"
                name="name"
                type="text"
                required
                maxLength={200}
                defaultValue={org.name}
                className="w-full rounded-md ring-1 ring-brand-grey-300 bg-white px-3 py-2 font-body text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red"
              />
            </Field>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              <Field id="seat_limit" label="Seat limit">
                <input
                  id="seat_limit"
                  name="seat_limit"
                  type="number"
                  min={0}
                  max={100000}
                  defaultValue={org.seat_limit}
                  className="w-full rounded-md ring-1 ring-brand-grey-300 bg-white px-3 py-2 font-body text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red"
                />
              </Field>
              <Field id="quota_daily" label="Daily quota / user">
                <input
                  id="quota_daily"
                  name="quota_daily"
                  type="number"
                  min={0}
                  defaultValue={org.quota_daily}
                  className="w-full rounded-md ring-1 ring-brand-grey-300 bg-white px-3 py-2 font-body text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red"
                />
              </Field>
              <Field id="quota_monthly" label="Monthly quota / user">
                <input
                  id="quota_monthly"
                  name="quota_monthly"
                  type="number"
                  min={0}
                  defaultValue={org.quota_monthly}
                  className="w-full rounded-md ring-1 ring-brand-grey-300 bg-white px-3 py-2 font-body text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red"
                />
              </Field>
            </div>
            <div className="flex justify-end">
              <SubmitButton
                pendingLabel="Saving…"
                className="inline-flex items-center rounded-pill bg-brand-red px-5 py-2.5 font-heading font-bold text-white border border-brand-red transition-colors hover:bg-brand-red-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                Save settings
              </SubmitButton>
            </div>
          </form>
        </section>

        <section className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 p-6">
          <h2 className="font-heading font-bold text-lg text-brand-black">
            Lifecycle
          </h2>
          <p className="mt-1 font-body text-sm text-brand-grey-700">
            Suspended organisations cannot sign in (existing data is preserved).
            Archived organisations are hidden from billing roll-ups.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <StatusButton
              currentStatus={org.status}
              targetStatus="Active"
              orgId={org.id}
              label="Activate"
            />
            <StatusButton
              currentStatus={org.status}
              targetStatus="Suspended"
              orgId={org.id}
              label="Suspend"
            />
            <StatusButton
              currentStatus={org.status}
              targetStatus="Archived"
              orgId={org.id}
              label="Archive"
            />
          </div>
        </section>

        <section className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 p-6">
          <h2 className="font-heading font-bold text-lg text-brand-black">
            Branding
          </h2>
          {sp.branding_reset ? (
            <p
              role="status"
              className="mt-2 font-body text-sm text-brand-grey-700"
            >
              Branding reset to the platform default.
            </p>
          ) : null}
          {branding.customised && branding.row ? (
            <div className="mt-4 flex flex-wrap items-center gap-6">
              <div className="flex items-center gap-2">
                <span
                  className="h-6 w-6 rounded-full ring-1 ring-brand-grey-200"
                  style={{ background: branding.theme.primary_color }}
                  title={`Accent ${branding.theme.primary_color}`}
                />
                <span
                  className="h-6 w-6 rounded-full ring-1 ring-brand-grey-200"
                  style={{ background: branding.theme.surface_dark_color }}
                  title={`Surface ${branding.theme.surface_dark_color}`}
                />
                <span className="font-body text-sm text-brand-grey-700">
                  {branding.theme.primary_color} ·{" "}
                  {branding.theme.surface_dark_color}
                </span>
              </div>
              <p className="font-body text-sm text-brand-grey-700">
                Font:{" "}
                <strong>
                  {BRANDING_FONTS[branding.theme.font_key as BrandingFontKey]
                    ?.label ?? branding.theme.font_key}
                </strong>
              </p>
              <p className="font-body text-sm text-brand-grey-700">
                Logo:{" "}
                <strong>
                  {branding.row.logo_object_key ? "uploaded" : "none"}
                </strong>
              </p>
              <form action={resetOrgBrandingFromForm}>
                <input type="hidden" name="org_id" value={org.id} />
                <ConfirmSubmitButton
                  confirmMessage={`Reset ${org.name}'s branding to the platform default? Their logo will be deleted.`}
                  pendingLabel="Resetting…"
                  className="font-heading font-bold text-sm text-brand-red hover:text-brand-red-dark transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red rounded-sm disabled:opacity-60"
                >
                  Reset branding
                </ConfirmSubmitButton>
              </form>
            </div>
          ) : (
            <p className="mt-2 font-body text-sm text-brand-grey-700">
              Platform default — this organisation hasn&apos;t customised its
              branding.
            </p>
          )}
        </section>

        <section>
          <h2 className="font-heading font-bold text-xl text-brand-black">
            Recent activity
          </h2>
          <div className="mt-4 rounded-lg bg-brand-white ring-1 ring-brand-grey-200 overflow-hidden">
            {activity.length === 0 ? (
              <p className="px-6 py-8 font-body text-base text-brand-grey-700">
                Nothing has happened in this organisation yet.
              </p>
            ) : (
              <ul className="divide-y divide-brand-grey-200">
                {activity.map((row) => (
                  <li
                    key={row.id}
                    className="px-6 py-4 flex items-center justify-between gap-4"
                  >
                    <div className="min-w-0">
                      <p className="font-heading font-bold text-sm text-brand-black truncate">
                        {row.action}
                      </p>
                      <p className="font-body text-xs text-brand-grey-700 truncate">
                        {row.user?.name ?? row.user?.email ?? "—"}
                      </p>
                    </div>
                    <time
                      dateTime={row.timestamp.toISOString()}
                      className="font-body text-xs text-brand-grey-500 whitespace-nowrap"
                    >
                      {formatRelative(row.timestamp)}
                    </time>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </section>
  );
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

function Stat({
  label,
  value,
  sub,
  pct,
}: {
  label: string;
  value: string;
  sub: string | null;
  pct?: number;
}) {
  return (
    <div className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 p-5">
      <p className="font-body text-xs uppercase tracking-widest text-brand-grey-500">
        {label}
      </p>
      <p className="mt-1 font-display italic font-bold text-3xl text-brand-black leading-none">
        {value}
      </p>
      {sub ? (
        <p className="mt-1 font-body text-sm text-brand-grey-700">{sub}</p>
      ) : null}
      {typeof pct === "number" ? (
        <div
          className="mt-4 h-1.5 w-full rounded-full bg-brand-grey-200 overflow-hidden"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="h-full bg-brand-red" style={{ width: `${pct}%` }} />
        </div>
      ) : null}
    </div>
  );
}

function StatusButton({
  currentStatus,
  targetStatus,
  orgId,
  label,
}: {
  currentStatus: "Active" | "Suspended" | "Archived";
  targetStatus: "Active" | "Suspended" | "Archived";
  orgId: string;
  label: string;
}) {
  const isCurrent = currentStatus === targetStatus;
  return (
    <form action={setOrgStatusFromForm}>
      <input type="hidden" name="org_id" value={orgId} />
      <input type="hidden" name="status" value={targetStatus} />
      <SubmitButton
        disabled={isCurrent}
        aria-pressed={isCurrent}
        className={`inline-flex items-center rounded-pill px-4 py-2 font-heading font-bold text-sm border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 ${
          isCurrent
            ? "bg-brand-black text-white border-brand-black cursor-default"
            : "bg-brand-white text-brand-black border-brand-grey-300 hover:bg-brand-grey-50"
        }`}
      >
        {isCurrent ? `${label} (current)` : label}
      </SubmitButton>
    </form>
  );
}

function Banner({
  tone,
  children,
}: {
  tone: "success" | "error";
  children: React.ReactNode;
}) {
  const styles =
    tone === "error"
      ? "bg-brand-red-soft ring-brand-red/40 text-brand-grey-900"
      : "bg-brand-white ring-brand-grey-200 text-brand-grey-900";
  return (
    <div className={`rounded-lg ring-1 px-5 py-3 ${styles}`}>
      <p className="font-body text-sm">{children}</p>
    </div>
  );
}
