import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth/context";
import { createOrgFromForm } from "@/lib/super/org-actions";

export const metadata: Metadata = {
  title: "New organisation · SuperAdmin",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const ERROR_COPY: Record<string, string> = {
  name_required: "Name is required.",
  name_too_long: "Name is too long (max 200 characters).",
  seat_limit_invalid:
    "Seat limit must be a whole number between 0 and 100,000.",
  quota_daily_invalid: "Daily quota must be a whole non-negative number.",
  quota_monthly_invalid: "Monthly quota must be a whole non-negative number.",
};

export default async function NewOrgPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requireRole("SuperAdmin");
  const sp = await searchParams;
  const errorMessage = sp.error ? ERROR_COPY[sp.error] ?? sp.error : null;

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
            Stand up a customer org. Seats and quotas can be edited later.
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
              className="w-full rounded-md ring-1 ring-brand-grey-300 bg-white px-3 py-2 font-body text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red"
            />
          </Field>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <Field
              id="seat_limit"
              label="Seat limit"
              hint="Max active learners."
            >
              <input
                id="seat_limit"
                name="seat_limit"
                type="number"
                min={0}
                max={100000}
                defaultValue={25}
                className="w-full rounded-md ring-1 ring-brand-grey-300 bg-white px-3 py-2 font-body text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red"
              />
            </Field>
            <Field
              id="quota_daily"
              label="Daily AI calls / user"
              hint="0 = no quota."
            >
              <input
                id="quota_daily"
                name="quota_daily"
                type="number"
                min={0}
                defaultValue={50}
                className="w-full rounded-md ring-1 ring-brand-grey-300 bg-white px-3 py-2 font-body text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red"
              />
            </Field>
            <Field
              id="quota_monthly"
              label="Monthly AI calls / user"
              hint="0 = no quota."
            >
              <input
                id="quota_monthly"
                name="quota_monthly"
                type="number"
                min={0}
                defaultValue={1000}
                className="w-full rounded-md ring-1 ring-brand-grey-300 bg-white px-3 py-2 font-body text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red"
              />
            </Field>
          </div>

          <div className="flex items-center justify-between gap-3 pt-2">
            <Link
              href="/orgs"
              className="font-body text-sm text-brand-grey-700 hover:text-brand-black underline-offset-4 hover:underline"
            >
              Cancel
            </Link>
            <button
              type="submit"
              className="inline-flex items-center rounded-pill bg-brand-red px-5 py-2.5 font-heading font-bold text-white border border-brand-red transition-colors hover:bg-brand-red-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2"
            >
              Create organisation
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}

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
