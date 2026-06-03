import type { Metadata } from "next";
import Link from "next/link";
import {
  PORTAL_ELIGIBLE_STATUSES,
  getOrgBillingSnapshot,
  subscriptionStatusLabel,
  type OrgBillingSnapshot,
} from "@elc/db";
import { requireRole } from "@/lib/auth/context";
import { openBillingPortalFromForm } from "@/lib/billing/portal";
import { SubmitButton } from "@/components/ui/submit-button";

export const metadata: Metadata = {
  title: "Billing · eLanguage Center",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type SearchParams = { error?: string };

const ERROR_COPY: Record<string, string> = {
  not_billing_owner:
    "Only the billing owner can open the Stripe Billing Portal. Ask them to manage payment methods, invoices, or cancellation.",
  no_stripe_customer:
    "This organisation isn't on a paid plan, so there's nothing to manage in the Stripe Portal.",
  portal_failed:
    "We couldn't open the Stripe Billing Portal. Please try again in a moment.",
};

function formatDate(d: Date | null): string {
  if (!d) return "—";
  return d.toISOString().slice(0, 10);
}

function priceLine(amount: { toString: () => string } | undefined): string {
  if (!amount) return "—";
  const n = Number(amount.toString());
  if (!Number.isFinite(n) || n === 0) return "Free";
  return `$${n.toFixed(0)}/month`;
}

function daysUntil(d: Date | null): number | null {
  if (!d) return null;
  const ms = d.getTime() - Date.now();
  if (ms <= 0) return 0;
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

function statusBadgeClasses(status: string) {
  switch (status) {
    case "Active":
    case "Trialing":
      return "bg-brand-black text-white";
    case "PastDue":
    case "Incomplete":
      return "bg-brand-red-soft text-brand-grey-900 ring-1 ring-brand-red/40";
    case "Canceled":
      return "bg-brand-red text-white";
    default:
      return "bg-brand-grey-200 text-brand-grey-700";
  }
}

export default async function AdminBillingPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const ctx = await requireRole("OrgAdmin");
  const sp = await searchParams;
  const snapshot = await getOrgBillingSnapshot(ctx);

  const errorMessage = sp.error
    ? ERROR_COPY[sp.error] ?? sp.error
    : null;

  const trialDaysLeft =
    snapshot.org.subscription_status === "Trialing"
      ? daysUntil(snapshot.org.trial_end)
      : null;

  const portalEligible =
    PORTAL_ELIGIBLE_STATUSES.has(snapshot.org.subscription_status) &&
    Boolean(snapshot.org.stripe_customer_id);
  const portalButtonEnabled =
    portalEligible && snapshot.is_billing_owner;

  return (
    <section className="px-6 py-12 md:py-16">
      <div className="mx-auto max-w-4xl space-y-10">
        <header>
          <p className="font-body text-sm uppercase tracking-widest text-brand-red">
            Admin
          </p>
          <h1 className="mt-2 font-display italic font-bold text-4xl md:text-5xl text-brand-black leading-tight">
            Billing.
          </h1>
          <p className="mt-3 font-body text-base text-brand-grey-700">
            Your subscription, seat usage, and AI quota for{" "}
            <strong>{snapshot.org.name}</strong>. Card, invoices, and
            cancellation live in the Stripe Billing Portal.
          </p>
        </header>

        {errorMessage ? (
          <div className="rounded-lg ring-1 bg-brand-red-soft ring-brand-red/40 px-5 py-3">
            <p className="font-body text-sm text-brand-grey-900">
              {errorMessage}
            </p>
          </div>
        ) : null}

        {trialDaysLeft !== null && trialDaysLeft <= 3 ? (
          <div className="rounded-lg ring-1 bg-brand-red-soft ring-brand-red/40 px-5 py-3">
            <p className="font-body text-sm text-brand-grey-900">
              <strong>Trial ending in {trialDaysLeft}{" "}
              {trialDaysLeft === 1 ? "day" : "days"}.</strong>{" "}
              Your card will be charged{" "}
              {priceLine(snapshot.plan?.amount_monthly_usd)} on{" "}
              {formatDate(snapshot.org.trial_end)}. Manage your billing
              before then to change or cancel.
            </p>
          </div>
        ) : null}

        <section className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="font-body text-xs uppercase tracking-widest text-brand-grey-500">
                Current plan
              </p>
              <h2 className="mt-1 font-heading font-bold text-2xl text-brand-black">
                {snapshot.plan?.name ?? "No plan assigned"}
              </h2>
              <p className="mt-1 font-display italic font-bold text-3xl text-brand-black leading-none">
                {priceLine(snapshot.plan?.amount_monthly_usd)}
              </p>
            </div>
            <span
              className={`inline-flex items-center rounded-pill px-4 py-1.5 font-heading font-bold text-sm ${statusBadgeClasses(snapshot.org.subscription_status)}`}
            >
              {subscriptionStatusLabel(snapshot.org.subscription_status)}
            </span>
          </div>

          <dl className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-brand-grey-200 pt-6">
            {snapshot.org.subscription_status === "Trialing" ? (
              <Fact label="Trial ends">
                {formatDate(snapshot.org.trial_end)}
              </Fact>
            ) : null}
            {snapshot.org.current_period_end ? (
              <Fact label="Next renewal">
                {formatDate(snapshot.org.current_period_end)}
              </Fact>
            ) : null}
            <Fact label="Provisioned via">
              {snapshot.org.provisioned_via === "self_serve"
                ? "Self-serve"
                : snapshot.org.provisioned_via === "invite"
                  ? "SuperAdmin invite"
                  : "Seeded"}
            </Fact>
            {snapshot.billing_owner ? (
              <Fact label="Billing owner">
                {snapshot.billing_owner.name ??
                  snapshot.billing_owner.email}
              </Fact>
            ) : null}
          </dl>

          <div className="mt-6">
            <BillingCta
              snapshot={snapshot}
              portalEligible={portalEligible}
              portalButtonEnabled={portalButtonEnabled}
            />
          </div>
        </section>

        <section className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <Stat
            label="Active learners"
            value={`${snapshot.active_learner_count} / ${snapshot.org.seat_limit || "—"}`}
            sub={
              snapshot.org.seat_limit > 0
                ? `${Math.max(0, snapshot.org.seat_limit - snapshot.active_learner_count)} seats remaining`
                : "No seat limit set."
            }
            pct={
              snapshot.org.seat_limit > 0
                ? Math.min(
                    100,
                    Math.round(
                      (snapshot.active_learner_count /
                        snapshot.org.seat_limit) *
                        100,
                    ),
                  )
                : null
            }
          />
          <Stat
            label="AI calls today (org-wide)"
            value={snapshot.ai_usage_today.toString()}
            sub={
              snapshot.org.quota_daily > 0
                ? `Per-user limit: ${snapshot.org.quota_daily}/day`
                : "No daily quota."
            }
          />
          <Stat
            label="AI calls this month (org-wide)"
            value={snapshot.ai_usage_month_to_date.toString()}
            sub={
              snapshot.org.quota_monthly > 0
                ? `Per-user limit: ${snapshot.org.quota_monthly}/mo`
                : "No monthly quota."
            }
          />
        </section>

        <section className="rounded-lg bg-brand-grey-50 ring-1 ring-brand-grey-200 px-6 py-5">
          <p className="font-body text-sm text-brand-grey-700">
            Need a different plan or larger limits?{" "}
            <Link
              href="/pricing"
              className="text-brand-black hover:text-brand-red underline-offset-4 hover:underline"
            >
              See all plans
            </Link>{" "}
            or talk to your account contact.
          </p>
        </section>
      </div>
    </section>
  );
}

// Picks the right billing CTA based on subscription state. The button
// label and target action change for Internal / PendingPayment /
// Canceled / non-billing-owner so the OrgAdmin always has a clickable
// next step rather than a disabled tooltip.
function BillingCta({
  snapshot,
  portalEligible,
  portalButtonEnabled,
}: {
  snapshot: OrgBillingSnapshot;
  portalEligible: boolean;
  portalButtonEnabled: boolean;
}) {
  const status = snapshot.org.subscription_status;
  const preselectQuery = snapshot.plan?.slug
    ? `?preselect=${encodeURIComponent(snapshot.plan.slug)}`
    : "";

  // PendingPayment: send them to the onboarding wizard so they can
  // finish Checkout with the plan that's already stamped on their Org.
  if (status === "PendingPayment") {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href={`/onboarding/plan${preselectQuery}`}
          className="inline-flex items-center rounded-pill bg-brand-red text-white px-5 py-2.5 font-heading font-bold border border-brand-red transition-colors hover:bg-brand-red-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2"
        >
          Complete checkout
        </Link>
        <p className="font-body text-sm text-brand-grey-700">
          Your subscription isn&rsquo;t active yet — finish picking a plan
          and entering payment.
        </p>
      </div>
    );
  }

  // Internal: no Stripe customer (Free plan or seeded org). Surface a
  // clear "Upgrade" CTA pointing at /pricing rather than a dead button.
  if (status === "Internal" || !portalEligible) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/pricing"
          className="inline-flex items-center rounded-pill bg-brand-red text-white px-5 py-2.5 font-heading font-bold border border-brand-red transition-colors hover:bg-brand-red-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2"
        >
          Upgrade your plan
        </Link>
        <p className="font-body text-sm text-brand-grey-700">
          You&rsquo;re on a non-billed plan — upgrade to unlock seats and
          AI quota.
        </p>
      </div>
    );
  }

  // Canceled: subscription gone, but Org row still here. Resubscribe via
  // /pricing.
  if (status === "Canceled") {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/pricing"
          className="inline-flex items-center rounded-pill bg-brand-red text-white px-5 py-2.5 font-heading font-bold border border-brand-red transition-colors hover:bg-brand-red-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2"
        >
          Resubscribe
        </Link>
        <p className="font-body text-sm text-brand-grey-700">
          Your previous subscription was cancelled. Pick a plan to start
          again.
        </p>
      </div>
    );
  }

  // Active / Trialing / PastDue / Incomplete with a Stripe customer:
  // route through the hosted Billing Portal. Non-billing-owners get a
  // disabled button + read-only note.
  return (
    <div className="flex flex-wrap items-center gap-3">
      <form action={openBillingPortalFromForm}>
        <SubmitButton
          disabled={!portalButtonEnabled}
          pendingLabel="Opening…"
          title={
            !snapshot.is_billing_owner
              ? `Only ${snapshot.billing_owner?.email ?? "the billing owner"} can open the portal.`
              : undefined
          }
          className="inline-flex items-center rounded-pill bg-brand-red text-white px-5 py-2.5 font-heading font-bold border border-brand-red transition-colors hover:bg-brand-red-dark disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2"
        >
          Manage billing
        </SubmitButton>
      </form>
      {!snapshot.is_billing_owner ? (
        <p className="font-body text-sm text-brand-grey-700">
          Read-only — ask{" "}
          <strong>
            {snapshot.billing_owner?.email ?? "your billing owner"}
          </strong>{" "}
          to update payment or cancel.
        </p>
      ) : null}
    </div>
  );
}

function Fact({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="font-body text-xs uppercase tracking-widest text-brand-grey-500">
        {label}
      </dt>
      <dd className="mt-1 font-heading font-bold text-base text-brand-black">
        {children}
      </dd>
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
  pct?: number | null;
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
