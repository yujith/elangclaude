import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  INTERNAL_PLAN_SLUG,
  getPlanByIdAsSuperAdmin,
  withSuperAdminContext,
} from "@elc/db";
import { requireRole } from "@/lib/auth/context";
import {
  archivePlanFromForm,
  updatePlanFromForm,
} from "@/lib/super/plan-actions";
import { planErrorMessage } from "@/lib/super/plan-errors";

export const metadata: Metadata = {
  title: "Plan · SuperAdmin",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type SearchParams = {
  created?: string;
  saved?: string;
  archived?: string;
  error?: string;
};

export default async function PlanDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ planId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const ctx = await requireRole("SuperAdmin");
  const { planId } = await params;
  const sp = await searchParams;

  const plan = await getPlanByIdAsSuperAdmin(ctx, planId);
  if (!plan) notFound();

  const db = withSuperAdminContext(ctx);
  const orgsOnPlan = await db.organization.count({
    where: { plan_id: plan.id },
  });

  const errorMessage = planErrorMessage(sp.error);
  const locked = plan.slug === INTERNAL_PLAN_SLUG;

  return (
    <section className="px-6 py-12 md:py-16">
      <div className="mx-auto max-w-3xl space-y-10">
        <div>
          <Link
            href="/plans"
            className="font-body text-sm text-brand-grey-700 hover:text-brand-black underline-offset-4 hover:underline"
          >
            ← All plans
          </Link>
        </div>

        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-body text-sm uppercase tracking-widest text-brand-red">
              Plan
            </p>
            <h1 className="mt-2 font-display italic font-bold text-4xl md:text-5xl text-brand-black leading-tight">
              {plan.name}.
            </h1>
            <p className="mt-3 font-body text-sm text-brand-grey-700">
              <code className="font-mono text-xs">{plan.slug}</code> ·{" "}
              {orgsOnPlan} {orgsOnPlan === 1 ? "org" : "orgs"} on this plan ·
              created {plan.createdAt.toISOString().slice(0, 10)}
            </p>
          </div>
          <span
            className={`inline-flex items-center rounded-pill px-4 py-1.5 font-heading font-bold text-sm ${
              plan.is_internal
                ? "bg-brand-grey-200 text-brand-grey-700"
                : plan.is_active
                  ? "bg-brand-black text-white"
                  : "bg-brand-red-soft text-brand-grey-900 ring-1 ring-brand-red/40"
            }`}
          >
            {plan.is_internal
              ? "Internal"
              : plan.is_active
                ? "Active"
                : "Archived"}
          </span>
        </header>

        {sp.created ? (
          <Banner tone="success">
            Plan created. Stripe sync will pick this up once Phase 2 lands.
          </Banner>
        ) : null}
        {sp.saved ? <Banner tone="success">Plan saved.</Banner> : null}
        {sp.archived ? <Banner tone="success">Plan archived.</Banner> : null}
        {errorMessage ? <Banner tone="error">{errorMessage}</Banner> : null}

        {locked ? (
          <div className="rounded-lg bg-brand-grey-50 ring-1 ring-brand-grey-200 p-6">
            <h2 className="font-heading font-bold text-lg text-brand-black">
              Locked
            </h2>
            <p className="mt-1 font-body text-sm text-brand-grey-700">
              The internal plan is infrastructure. It cannot be edited or
              archived from this UI. If you need to change it, do so directly
              in the database and update the seed.
            </p>
            <dl className="mt-5 grid grid-cols-2 md:grid-cols-4 gap-4">
              <Stat label="Seats" value={plan.seat_limit} />
              <Stat label="Daily quota" value={plan.quota_daily} />
              <Stat label="Monthly quota" value={plan.quota_monthly} />
              <Stat label="Price" value="$0" />
            </dl>
          </div>
        ) : (
          <form
            action={updatePlanFromForm}
            className="space-y-5 rounded-lg bg-brand-white ring-1 ring-brand-grey-200 p-6"
          >
            <input type="hidden" name="plan_id" value={plan.id} />

            <Field id="name" label="Plan name">
              <input
                id="name"
                name="name"
                type="text"
                required
                maxLength={100}
                defaultValue={plan.name}
                className={inputClasses}
              />
            </Field>

            <Field id="description" label="Short description">
              <input
                id="description"
                name="description"
                type="text"
                maxLength={500}
                defaultValue={plan.description ?? ""}
                className={inputClasses}
              />
            </Field>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              <Field id="seat_limit" label="Seat limit">
                <input
                  id="seat_limit"
                  name="seat_limit"
                  type="number"
                  required
                  min={1}
                  max={100000}
                  defaultValue={plan.seat_limit}
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
                  defaultValue={plan.quota_daily}
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
                  defaultValue={plan.quota_monthly}
                  className={inputClasses}
                />
              </Field>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              <Field id="amount_monthly_usd" label="Monthly price (USD)">
                <input
                  id="amount_monthly_usd"
                  name="amount_monthly_usd"
                  type="number"
                  required
                  min={0}
                  step="0.01"
                  defaultValue={Number(plan.amount_monthly_usd.toString())}
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
                  defaultValue={plan.trial_days}
                  className={inputClasses}
                />
              </Field>
              <Field id="sort_order" label="Sort order">
                <input
                  id="sort_order"
                  name="sort_order"
                  type="number"
                  required
                  min={0}
                  max={10000}
                  defaultValue={plan.sort_order}
                  className={inputClasses}
                />
              </Field>
            </div>

            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                name="is_active"
                defaultChecked={plan.is_active}
                className="h-4 w-4 rounded border-brand-grey-300 text-brand-red focus:ring-brand-red"
              />
              <span className="font-body text-sm text-brand-grey-900">
                Active — visible to customers
              </span>
            </label>

            <div className="flex justify-end">
              <button
                type="submit"
                className="inline-flex items-center rounded-pill bg-brand-red px-5 py-2.5 font-heading font-bold text-white border border-brand-red transition-colors hover:bg-brand-red-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2"
              >
                Save plan
              </button>
            </div>
          </form>
        )}

        {!locked && plan.is_active ? (
          <section className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 p-6">
            <h2 className="font-heading font-bold text-lg text-brand-black">
              Archive
            </h2>
            <p className="mt-1 font-body text-sm text-brand-grey-700">
              Archived plans stay in the catalogue for existing subscribers but
              disappear from the pricing page. Orgs already on this plan are
              unaffected.
            </p>
            <form action={archivePlanFromForm} className="mt-5">
              <input type="hidden" name="plan_id" value={plan.id} />
              <button
                type="submit"
                className="inline-flex items-center rounded-pill bg-brand-white text-brand-black px-4 py-2 font-heading font-bold text-sm border border-brand-grey-300 hover:bg-brand-grey-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2"
              >
                Archive plan
              </button>
            </form>
          </section>
        ) : null}
      </div>
    </section>
  );
}

const inputClasses =
  "w-full rounded-md ring-1 ring-brand-grey-300 bg-white px-3 py-2 font-body text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red";

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

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dt className="font-body text-xs uppercase tracking-widest text-brand-grey-500">
        {label}
      </dt>
      <dd className="mt-1 font-display italic font-bold text-2xl text-brand-black leading-none">
        {value}
      </dd>
    </div>
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
