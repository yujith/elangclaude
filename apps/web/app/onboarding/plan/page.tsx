import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { listPlansForCustomer } from "@elc/db";
import { prisma } from "@elc/db/client";
import { requireRole } from "@/lib/auth/context";
import { selectPlanFromForm } from "@/lib/onboarding/checkout-actions";
import { SubmitButton } from "@/components/ui/submit-button";

export const metadata: Metadata = {
  title: "Pick your plan · eLanguage Center",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type SearchParams = {
  canceled?: string;
  preselect?: string;
  error?: string;
};

const ERROR_COPY: Record<string, string> = {
  plan_not_found: "That plan isn’t available right now.",
  plan_inactive: "That plan has been archived. Pick another option.",
  plan_internal: "That plan is internal-only.",
  plan_not_synced:
    "That plan isn’t fully set up yet. A SuperAdmin needs to finish syncing it to Stripe — try again in a few minutes.",
  plan_not_free: "That plan isn’t free — please go through Checkout.",
  org_not_found: "We couldn’t find your organisation.",
  org_not_pending: "Your subscription is already set up. Heading to your dashboard…",
  not_billing_owner:
    "Only the billing owner of your organisation can choose a plan. Ask them to finish setup.",
  checkout_failed: "We couldn’t open Checkout. Please try again.",
  config: "Server configuration is missing. Please contact support.",
};

function priceLine(amount_monthly_usd: { toString: () => string }): string {
  const n = Number(amount_monthly_usd.toString());
  if (!Number.isFinite(n) || n === 0) return "Free";
  return `$${n.toFixed(0)}/month`;
}

export default async function OnboardingPlanPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const ctx = await requireRole("OrgAdmin");
  const org = await prisma.organization.findUnique({
    where: { id: ctx.org_id },
    select: { subscription_status: true },
  });
  if (!org) redirect("/no-access");
  // Already activated — short-circuit to /admin. /processing handles the
  // post-Checkout transition state.
  if (org.subscription_status !== "PendingPayment") {
    redirect("/admin");
  }

  const sp = await searchParams;
  const plans = await listPlansForCustomer();
  const preselect = sp.preselect ?? null;
  const errorMessage = sp.error
    ? ERROR_COPY[sp.error] ?? sp.error
    : null;

  return (
    <section className="px-6 py-12 md:py-16">
      <div className="mx-auto max-w-5xl space-y-10">
        <header>
          <p className="font-body text-sm uppercase tracking-widest text-brand-red">
            Welcome
          </p>
          <h1 className="mt-2 font-display italic font-bold text-4xl md:text-5xl text-brand-black leading-tight">
            Pick the plan that fits.
          </h1>
          <p className="mt-3 font-body text-base text-brand-grey-700 max-w-2xl">
            Skills That Open Doorways. Start free, or pick a paid tier and
            unlock the full IELTS prep stack with a 14-day trial. You can
            change plans later from your billing settings.
          </p>
        </header>

        {sp.canceled ? (
          <div className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 px-5 py-3">
            <p className="font-body text-sm text-brand-grey-900">
              Checkout cancelled. You can pick a plan again whenever you’re
              ready.
            </p>
          </div>
        ) : null}
        {errorMessage ? (
          <div className="rounded-lg bg-brand-red-soft ring-1 ring-brand-red/40 px-5 py-3">
            <p className="font-body text-sm text-brand-grey-900">{errorMessage}</p>
          </div>
        ) : null}

        {plans.length === 0 ? (
          <p className="font-body text-base text-brand-grey-700">
            No plans are available right now. Please contact support.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
            {plans.map((plan) => {
              const highlight = plan.slug === preselect;
              return (
                <article
                  key={plan.id}
                  className={`flex flex-col rounded-lg bg-brand-white p-6 ring-1 ${
                    highlight
                      ? "ring-brand-red"
                      : "ring-brand-grey-200"
                  }`}
                >
                  <h2 className="font-heading font-bold text-xl text-brand-black">
                    {plan.name}
                  </h2>
                  <p className="mt-1 font-display italic font-bold text-3xl text-brand-black leading-none">
                    {priceLine(plan.amount_monthly_usd)}
                  </p>
                  {plan.description ? (
                    <p className="mt-3 font-body text-sm text-brand-grey-700">
                      {plan.description}
                    </p>
                  ) : null}
                  <dl className="mt-4 space-y-1 font-body text-sm text-brand-grey-700">
                    <Fact label="Learners">{plan.seat_limit}</Fact>
                    <Fact label="Daily AI calls / user">
                      {plan.quota_daily}
                    </Fact>
                    <Fact label="Monthly AI calls / user">
                      {plan.quota_monthly}
                    </Fact>
                    {plan.trial_days > 0 ? (
                      <Fact label="Trial">{`${plan.trial_days} days`}</Fact>
                    ) : null}
                  </dl>
                  <form action={selectPlanFromForm} className="mt-6">
                    <input type="hidden" name="plan_id" value={plan.id} />
                    <SubmitButton
                      pendingLabel="Setting up…"
                      className="inline-flex w-full items-center justify-center rounded-pill bg-brand-red text-white px-5 py-2.5 font-heading font-bold border border-brand-red transition-colors hover:bg-brand-red-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {Number(plan.amount_monthly_usd.toString()) === 0
                        ? `Start with ${plan.name}`
                        : `Continue with ${plan.name}`}
                    </SubmitButton>
                  </form>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
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
    <div className="flex justify-between gap-3">
      <dt className="text-brand-grey-500">{label}</dt>
      <dd className="font-heading font-bold text-brand-black">{children}</dd>
    </div>
  );
}
