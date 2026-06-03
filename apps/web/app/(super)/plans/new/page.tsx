import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth/context";
import { createPlanFromForm } from "@/lib/super/plan-actions";
import { SubmitButton } from "@/components/ui/submit-button";
import { planErrorMessage } from "@/lib/super/plan-errors";

export const metadata: Metadata = {
  title: "New plan · SuperAdmin",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function NewPlanPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requireRole("SuperAdmin");
  const sp = await searchParams;
  const errorMessage = planErrorMessage(sp.error);

  return (
    <section className="px-6 py-12 md:py-16">
      <div className="mx-auto max-w-2xl space-y-8">
        <header>
          <p className="font-body text-sm uppercase tracking-widest text-brand-red">
            SuperAdmin · New
          </p>
          <h1 className="mt-2 font-display italic font-bold text-4xl md:text-5xl text-brand-black leading-tight">
            Create plan.
          </h1>
          <p className="mt-3 font-body text-base text-brand-grey-700">
            Plans drive both the onboarding picker and the seat / quota
            defaults copied onto each Org. Stripe sync runs in Phase 2.
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
          action={createPlanFromForm}
          className="space-y-5 rounded-lg bg-brand-white ring-1 ring-brand-grey-200 p-6"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <Field
              id="name"
              label="Plan name"
              hint="Shown on the pricing page and admin lists."
            >
              <input
                id="name"
                name="name"
                type="text"
                required
                maxLength={100}
                className={inputClasses}
              />
            </Field>
            <Field
              id="slug"
              label="Slug"
              hint="Lowercase, dashes ok. e.g. starter."
            >
              <input
                id="slug"
                name="slug"
                type="text"
                required
                maxLength={30}
                pattern="[a-z][a-z0-9-]*"
                className={inputClasses}
              />
            </Field>
          </div>

          <Field
            id="description"
            label="Short description"
            hint="Optional. One sentence shown on the pricing card."
          >
            <input
              id="description"
              name="description"
              type="text"
              maxLength={500}
              className={inputClasses}
            />
          </Field>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <Field id="seat_limit" label="Seat limit" hint="Active learners.">
              <input
                id="seat_limit"
                name="seat_limit"
                type="number"
                required
                min={1}
                max={100000}
                defaultValue={25}
                className={inputClasses}
              />
            </Field>
            <Field id="quota_daily" label="Daily quota / user">
              <input
                id="quota_daily"
                name="quota_daily"
                type="number"
                required
                min={0}
                defaultValue={50}
                className={inputClasses}
              />
            </Field>
            <Field id="quota_monthly" label="Monthly quota / user">
              <input
                id="quota_monthly"
                name="quota_monthly"
                type="number"
                required
                min={0}
                defaultValue={1000}
                className={inputClasses}
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <Field
              id="amount_monthly_usd"
              label="Monthly price (USD)"
              hint="Use 0 for a free tier."
            >
              <input
                id="amount_monthly_usd"
                name="amount_monthly_usd"
                type="number"
                required
                min={0}
                step="0.01"
                defaultValue={49}
                className={inputClasses}
              />
            </Field>
            <Field id="trial_days" label="Trial days">
              <input
                id="trial_days"
                name="trial_days"
                type="number"
                required
                min={0}
                max={90}
                defaultValue={14}
                className={inputClasses}
              />
            </Field>
            <Field
              id="sort_order"
              label="Sort order"
              hint="Lower = first on pricing page."
            >
              <input
                id="sort_order"
                name="sort_order"
                type="number"
                required
                min={0}
                max={10000}
                defaultValue={100}
                className={inputClasses}
              />
            </Field>
          </div>

          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              name="is_active"
              defaultChecked
              className="h-4 w-4 rounded border-brand-grey-300 text-brand-red focus:ring-brand-red"
            />
            <span className="font-body text-sm text-brand-grey-900">
              Active — visible to customers
            </span>
          </label>

          <div className="flex items-center justify-between gap-3 pt-2">
            <Link
              href="/plans"
              className="font-body text-sm text-brand-grey-700 hover:text-brand-black underline-offset-4 hover:underline"
            >
              Cancel
            </Link>
            <SubmitButton
              pendingLabel="Creating…"
              className="inline-flex items-center rounded-pill bg-brand-red px-5 py-2.5 font-heading font-bold text-white border border-brand-red transition-colors hover:bg-brand-red-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              Create plan
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
