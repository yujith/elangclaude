import type { Metadata } from "next";
import Link from "next/link";
import {
  INTERNAL_PLAN_SLUG,
  listPlansAsSuperAdmin,
} from "@elc/db";
import { requireRole } from "@/lib/auth/context";
import { syncAllPaidPlansFromForm } from "@/lib/super/plan-actions";
import { planErrorMessage } from "@/lib/super/plan-errors";

export const metadata: Metadata = {
  title: "Plans · SuperAdmin",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type SearchParams = {
  created?: string;
  archived?: string;
  error?: string;
  bulk_synced?: string;
  bulk_skipped?: string;
  bulk_failed?: string;
};

function badgeClasses(plan: { is_active: boolean; is_internal: boolean }) {
  if (plan.is_internal) {
    return "bg-brand-grey-200 text-brand-grey-700";
  }
  if (!plan.is_active) {
    return "bg-brand-red-soft text-brand-grey-900 ring-1 ring-brand-red/40";
  }
  return "bg-brand-black text-white";
}

function badgeLabel(plan: { is_active: boolean; is_internal: boolean }) {
  if (plan.is_internal) return "Internal";
  if (!plan.is_active) return "Archived";
  return "Active";
}

function formatUsd(amount: { toString: () => string }) {
  const n = Number(amount.toString());
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return "Free";
  return `$${n.toFixed(0)}/mo`;
}

export default async function PlansListPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const ctx = await requireRole("SuperAdmin");
  const sp = await searchParams;

  const plans = await listPlansAsSuperAdmin(ctx, { includeInactive: true });
  const errorCopy = planErrorMessage(sp.error);

  return (
    <section className="px-6 py-12 md:py-16">
      <div className="mx-auto max-w-6xl space-y-10">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-body text-sm uppercase tracking-widest text-brand-red">
              SuperAdmin
            </p>
            <h1 className="mt-2 font-display italic font-bold text-4xl md:text-5xl text-brand-black leading-tight">
              Plans.
            </h1>
            <p className="mt-3 font-body text-base text-brand-grey-700 max-w-2xl">
              The catalogue customers can subscribe to. Seat limits and AI
              quotas are copied onto the Org on subscription activation.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <form action={syncAllPaidPlansFromForm}>
              <button
                type="submit"
                className="inline-flex items-center rounded-pill bg-brand-white text-brand-black px-4 py-2.5 font-heading font-bold border border-brand-grey-300 hover:bg-brand-grey-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2"
              >
                Sync all to Stripe
              </button>
            </form>
            <Link
              href="/plans/new"
              className="inline-flex items-center rounded-pill bg-brand-red px-5 py-2.5 font-heading font-bold text-white border border-brand-red transition-colors hover:bg-brand-red-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2"
            >
              New plan
            </Link>
          </div>
        </header>

        {sp.created ? (
          <Banner tone="success">Plan created.</Banner>
        ) : null}
        {sp.archived ? (
          <Banner tone="success">Plan archived.</Banner>
        ) : null}
        {sp.bulk_synced || sp.bulk_failed || sp.bulk_skipped ? (
          <Banner tone={sp.bulk_failed && Number(sp.bulk_failed) > 0 ? "error" : "success"}>
            Stripe sync: {sp.bulk_synced ?? 0} synced
            {sp.bulk_skipped ? `, ${sp.bulk_skipped} skipped (free / internal)` : ""}
            {sp.bulk_failed && Number(sp.bulk_failed) > 0
              ? `, ${sp.bulk_failed} failed — click into the plan to retry`
              : ""}
            .
          </Banner>
        ) : null}
        {errorCopy ? <Banner tone="error">{errorCopy}</Banner> : null}

        <div className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 overflow-hidden">
          {plans.length === 0 ? (
            <p className="px-6 py-8 font-body text-base text-brand-grey-700">
              No plans yet. Create one to make it available to customers.
            </p>
          ) : (
            <table className="w-full text-left">
              <thead className="bg-brand-grey-50">
                <tr>
                  <Th>Name</Th>
                  <Th>Slug</Th>
                  <Th>Price</Th>
                  <Th>Seats</Th>
                  <Th>Daily / Monthly quota</Th>
                  <Th>Status</Th>
                  <Th>{""}</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-grey-200">
                {plans.map((plan) => (
                  <tr key={plan.id}>
                    <Td>
                      <Link
                        href={`/plans/${plan.id}`}
                        className="font-heading font-bold text-sm text-brand-black hover:text-brand-red underline-offset-4 hover:underline"
                      >
                        {plan.name}
                      </Link>
                    </Td>
                    <Td>
                      <code className="font-mono text-xs text-brand-grey-700">
                        {plan.slug}
                      </code>
                    </Td>
                    <Td>
                      <span className="font-body text-sm text-brand-grey-700">
                        {formatUsd(plan.amount_monthly_usd)}
                      </span>
                    </Td>
                    <Td>
                      <span className="font-body text-sm text-brand-grey-700">
                        {plan.seat_limit}
                      </span>
                    </Td>
                    <Td>
                      <span className="font-body text-sm text-brand-grey-700">
                        {plan.quota_daily} / {plan.quota_monthly}
                      </span>
                    </Td>
                    <Td>
                      <span
                        className={`inline-flex items-center rounded-pill px-3 py-1 font-heading font-bold text-xs ${badgeClasses(plan)}`}
                      >
                        {badgeLabel(plan)}
                      </span>
                    </Td>
                    <Td>
                      {plan.slug === INTERNAL_PLAN_SLUG ? (
                        <span className="font-body text-sm text-brand-grey-500">
                          Locked
                        </span>
                      ) : (
                        <Link
                          href={`/plans/${plan.id}`}
                          className="font-body text-sm text-brand-black hover:text-brand-red underline-offset-4 hover:underline"
                        >
                          Edit →
                        </Link>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
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
