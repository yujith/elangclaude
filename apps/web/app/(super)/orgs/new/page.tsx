import type { Metadata } from "next";
import Link from "next/link";
import { listPlansAsSuperAdmin } from "@elc/db";
import { requireRole } from "@/lib/auth/context";
import { createOrgFromForm } from "@/lib/super/org-actions";
import { SubmitButton } from "@/components/ui/submit-button";

export const metadata: Metadata = {
  title: "New organisation · SuperAdmin",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const ERROR_COPY: Record<string, string> = {
  name_required: "Name is required.",
  name_too_long: "Name is too long (max 200 characters).",
  plan_required: "Pick a plan for this organisation.",
  plan_not_found: "That plan is no longer available — pick another.",
  invalid_admin_email:
    "Admin email is not a valid address. Leave blank to skip the invite, or enter a real email.",
  clerk_org_create_failed:
    "We couldn't create the Clerk Organization for this customer. Confirm CLERK_SECRET_KEY is set and that the SuperAdmin has signed in via Clerk at least once.",
  admin_invite_failed:
    "Organisation was created, but we couldn't send the admin invitation. Open the org and use \"Invite OrgAdmin\" to retry.",
};

function priceLine(amount: { toString: () => string }): string {
  const n = Number(amount.toString());
  if (!Number.isFinite(n) || n === 0) return "Free";
  return `$${n.toFixed(0)}/mo`;
}

export default async function NewOrgPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const ctx = await requireRole("SuperAdmin");
  const sp = await searchParams;
  const errorMessage = sp.error
    ? ERROR_COPY[sp.error] ?? sp.error
    : null;

  const plans = await listPlansAsSuperAdmin(ctx, { includeInactive: false });
  // Non-internal plans only — internal is the backfill row and never an
  // option for a new customer Org.
  const selectablePlans = plans.filter((p) => !p.is_internal);

  return (
    <section className="px-6 py-12 md:py-16">
      <div className="mx-auto max-w-2xl space-y-8">
        <header>
          <p className="font-body text-sm uppercase tracking-widest text-brand-red">
            SuperAdmin · New
          </p>
          <h1 className="mt-2 font-display italic font-bold text-4xl md:text-5xl text-brand-black leading-tight">
            Create organisation.
          </h1>
          <p className="mt-3 font-body text-base text-brand-grey-700">
            Stand up a customer org. Pick a plan to set the seat + quota
            defaults, and optionally invite the first OrgAdmin so they
            receive an email and land in the onboarding wizard on sign-in.
          </p>
        </header>

        {errorMessage ? (
          <div className="rounded-lg ring-1 bg-brand-red-soft ring-brand-red/40 px-5 py-3">
            <p className="font-body text-sm text-brand-grey-900">
              {errorMessage}
            </p>
          </div>
        ) : null}

        <form
          action={createOrgFromForm}
          className="space-y-5 rounded-lg bg-brand-white ring-1 ring-brand-grey-200 p-6"
        >
          <Field
            id="name"
            label="Organisation name"
            hint="Shown to OrgAdmins and learners."
          >
            <input
              id="name"
              name="name"
              type="text"
              required
              maxLength={200}
              autoComplete="off"
              className={inputClasses}
            />
          </Field>

          <Field
            id="plan_id"
            label="Plan"
            hint="Drives the seat limit + AI quota. SuperAdmin can change later."
          >
            {selectablePlans.length === 0 ? (
              <p className="font-body text-sm text-brand-grey-700">
                No active plans yet.{" "}
                <Link
                  href="/plans/new"
                  className="text-brand-black underline hover:text-brand-red"
                >
                  Create one
                </Link>{" "}
                first.
              </p>
            ) : (
              <select
                id="plan_id"
                name="plan_id"
                required
                defaultValue=""
                className={inputClasses}
              >
                <option value="" disabled>
                  Choose a plan…
                </option>
                {selectablePlans.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.name} — {priceLine(plan.amount_monthly_usd)} ·{" "}
                    {plan.seat_limit} seats
                  </option>
                ))}
              </select>
            )}
          </Field>

          <div className="border-t border-brand-grey-200 pt-5">
            <p className="font-heading font-bold text-xs uppercase tracking-wide text-brand-grey-600 mb-3">
              Invite an OrgAdmin (optional)
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <Field
                id="admin_email"
                label="Admin email"
                hint="Sends a Clerk invitation. Leave blank to skip."
              >
                <input
                  id="admin_email"
                  name="admin_email"
                  type="email"
                  autoComplete="off"
                  placeholder="admin@example.com"
                  className={inputClasses}
                />
              </Field>
              <Field
                id="admin_name"
                label="Admin name"
                hint="Optional. Shown in the invite email."
              >
                <input
                  id="admin_name"
                  name="admin_name"
                  type="text"
                  maxLength={200}
                  autoComplete="off"
                  className={inputClasses}
                />
              </Field>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 pt-2">
            <Link
              href="/orgs"
              className="font-body text-sm text-brand-grey-700 hover:text-brand-black underline-offset-4 hover:underline"
            >
              Cancel
            </Link>
            <SubmitButton
              disabled={selectablePlans.length === 0}
              pendingLabel="Creating…"
              className="inline-flex items-center rounded-pill bg-brand-red px-5 py-2.5 font-heading font-bold text-white border border-brand-red transition-colors hover:bg-brand-red-dark disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2"
            >
              Create organisation
            </SubmitButton>
          </div>
        </form>
      </div>
    </section>
  );
}

const inputClasses =
  "w-full rounded-md ring-1 ring-brand-grey-300 bg-white px-3 py-2 font-body text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red";

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
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
      {hint ? (
        <p className="mt-1 font-body text-xs text-brand-grey-500">{hint}</p>
      ) : null}
    </div>
  );
}
