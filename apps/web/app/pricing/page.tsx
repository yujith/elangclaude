import type { Metadata } from "next";
import Link from "next/link";
import { listPlansForCustomer } from "@elc/db";
import { Logo } from "@/components/logo";
import { SiteFooter } from "@/components/site-footer";

export const metadata: Metadata = {
  title: "Pricing · eLanguage Center",
  description:
    "Plans for schools, migration agencies, and providers running IELTS prep. Start free, upgrade when you're ready.",
};

export const dynamic = "force-dynamic";

function priceLine(amount: { toString: () => string }): {
  display: string;
  isFree: boolean;
} {
  const n = Number(amount.toString());
  if (!Number.isFinite(n) || n === 0) return { display: "Free", isFree: true };
  return { display: `$${n.toFixed(0)}`, isFree: false };
}

export default async function PricingPage() {
  const plans = await listPlansForCustomer();

  return (
    <div className="min-h-screen flex flex-col bg-brand-grey-50">
      <header className="bg-brand-black text-white">
        <div className="mx-auto max-w-7xl px-6 py-4 flex items-center justify-between gap-4">
          <Link
            href="/"
            className="flex items-center gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 focus-visible:ring-offset-brand-black rounded-sm"
          >
            <Logo variant="on-dark" height={40} />
          </Link>
          <nav className="flex items-center gap-6">
            <Link
              href="/sign-in"
              className="font-heading font-bold text-sm text-white hover:text-brand-red transition-colors"
            >
              Sign in
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <section className="px-6 py-16 md:py-24">
          <div className="mx-auto max-w-3xl text-center space-y-6">
            <p className="font-body text-sm uppercase tracking-widest text-brand-red">
              Pricing
            </p>
            <h1 className="font-display italic font-bold text-5xl md:text-6xl text-brand-black leading-tight">
              Skills That Open Doorways.
            </h1>
            <p className="font-body text-lg text-brand-grey-700">
              Pick the plan that fits your school. Free to start, 14-day trial
              on every paid tier, change plans any time. No setup fees, no
              long-term contracts.
            </p>
          </div>
        </section>

        <section className="px-6 pb-20">
          {plans.length === 0 ? (
            <div className="mx-auto max-w-3xl text-center font-body text-base text-brand-grey-700">
              No plans are available right now. Please check back soon.
            </div>
          ) : (
            <div className="mx-auto max-w-6xl grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
              {plans.map((plan) => {
                const price = priceLine(plan.amount_monthly_usd);
                return (
                  <article
                    key={plan.id}
                    className="flex flex-col rounded-lg bg-brand-white p-6 ring-1 ring-brand-grey-200"
                  >
                    <h2 className="font-heading font-bold text-2xl text-brand-black">
                      {plan.name}
                    </h2>
                    <p className="mt-2 font-display italic font-bold text-4xl text-brand-black leading-none">
                      {price.display}
                    </p>
                    {!price.isFree ? (
                      <p className="mt-1 font-body text-sm text-brand-grey-500">
                        per month
                      </p>
                    ) : null}
                    {plan.description ? (
                      <p className="mt-4 font-body text-sm text-brand-grey-700">
                        {plan.description}
                      </p>
                    ) : null}
                    <dl className="mt-5 space-y-1.5 font-body text-sm text-brand-grey-700 border-t border-brand-grey-200 pt-5">
                      <Fact label="Active learners">
                        {plan.seat_limit.toLocaleString()}
                      </Fact>
                      <Fact label="Daily AI calls / user">
                        {plan.quota_daily.toLocaleString()}
                      </Fact>
                      <Fact label="Monthly AI calls / user">
                        {plan.quota_monthly.toLocaleString()}
                      </Fact>
                      {plan.trial_days > 0 ? (
                        <Fact label="Trial">
                          {`${plan.trial_days} days`}
                        </Fact>
                      ) : (
                        <Fact label="Card required">No</Fact>
                      )}
                    </dl>
                    <Link
                      href={`/signup-org?plan=${encodeURIComponent(plan.slug)}`}
                      className="mt-6 inline-flex w-full items-center justify-center rounded-pill bg-brand-red text-white px-5 py-2.5 font-heading font-bold border border-brand-red transition-colors hover:bg-brand-red-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2"
                    >
                      {price.isFree
                        ? `Start with ${plan.name}`
                        : `Try ${plan.name} free`}
                    </Link>
                  </article>
                );
              })}
            </div>
          )}
          <p className="mx-auto max-w-3xl mt-10 text-center font-body text-sm text-brand-grey-500">
            Already have an account?{" "}
            <Link
              href="/sign-in"
              className="text-brand-black hover:text-brand-red underline-offset-4 hover:underline"
            >
              Sign in
            </Link>
            .
          </p>
        </section>
      </main>

      <SiteFooter />
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
    <div className="flex justify-between gap-3">
      <dt className="text-brand-grey-500">{label}</dt>
      <dd className="font-heading font-bold text-brand-black">{children}</dd>
    </div>
  );
}
