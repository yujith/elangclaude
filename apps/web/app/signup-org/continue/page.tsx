import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import {
  getActivePlanBySlugForCustomer,
} from "@elc/db";
import { prisma } from "@elc/db/client";
import { Logo } from "@/components/logo";
import { SignOutControl } from "@/components/sign-out-control";
import { selfServeProvisionFromForm } from "@/lib/onboarding/self-serve-actions";

export const metadata: Metadata = {
  title: "Name your school · eLanguage Center",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type SearchParams = { plan?: string; error?: string };

const ERROR_COPY: Record<string, string> = {
  invalid_org_name: "Organisation name must be 2–120 characters.",
  invalid_plan_slug: "That plan link is broken. Pick a plan again.",
  plan_not_found: "That plan no longer exists. Pick another from /pricing.",
  plan_inactive: "That plan is no longer available. Pick another.",
  plan_internal: "That plan is internal-only.",
  email_already_in_use:
    "Your email is already on another eLanguage Center workspace. Sign in to that one, or contact support to merge accounts.",
  clerk_org_create_failed:
    "We couldn't set up your workspace. Please try again in a few minutes.",
};

export default async function SignupOrgContinuePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) redirect("/signup-org");

  // Multi-org guard: until MULTI_ORG_ENABLED=1, bounce existing users back
  // to /post-signin. With multi-org enabled, users can create additional orgs.
  const multiOrgEnabled = process.env.MULTI_ORG_ENABLED === "1";
  if (!multiOrgEnabled) {
    const existing = await prisma.user.findFirst({
      where: { clerk_user_id: clerkUserId },
      select: { id: true },
    });
    if (existing) redirect("/post-signin");
  }

  const sp = await searchParams;
  const slugInput =
    typeof sp.plan === "string" && sp.plan.length > 0 ? sp.plan : null;
  const plan = slugInput
    ? await getActivePlanBySlugForCustomer(slugInput)
    : null;
  if (!plan) redirect("/pricing");

  const errorMessage = sp.error ? ERROR_COPY[sp.error] ?? sp.error : null;

  return (
    <div className="min-h-screen flex flex-col bg-brand-grey-50">
      <header className="bg-brand-black text-white">
        <div className="mx-auto max-w-7xl px-6 py-3 flex items-center justify-between gap-4">
          <Link
            href="/"
            className="flex items-center gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 focus-visible:ring-offset-brand-black rounded-sm"
          >
            <Logo variant="on-dark" height={40} />
            <span className="font-body text-xs uppercase tracking-widest text-brand-grey-200">
              Set up
            </span>
          </Link>
          <SignOutControl />
        </div>
      </header>

      <main className="flex-1 px-6 py-12 md:py-16">
        <div className="mx-auto max-w-xl space-y-8">
          <header>
            <p className="font-body text-sm uppercase tracking-widest text-brand-red">
              Step 2 of 3
            </p>
            <h1 className="mt-2 font-display italic font-bold text-4xl md:text-5xl text-brand-black leading-tight">
              Name your school.
            </h1>
            <p className="mt-3 font-body text-base text-brand-grey-700">
              You picked <strong>{plan.name}</strong>. Tell us what to call
              your workspace — your learners will see this name.
            </p>
          </header>

          {errorMessage ? (
            <div className="rounded-lg bg-brand-red-soft ring-1 ring-brand-red/40 px-5 py-3">
              <p className="font-body text-sm text-brand-grey-900">
                {errorMessage}
              </p>
            </div>
          ) : null}

          <form
            action={selfServeProvisionFromForm}
            className="space-y-5 rounded-lg bg-brand-white ring-1 ring-brand-grey-200 p-6"
          >
            <input type="hidden" name="plan_slug" value={plan.slug} />

            <div>
              <label
                htmlFor="org_name"
                className="block font-heading font-bold text-xs uppercase tracking-wide text-brand-grey-600 mb-1"
              >
                Organisation name
              </label>
              <input
                id="org_name"
                name="org_name"
                type="text"
                required
                minLength={2}
                maxLength={120}
                autoComplete="organization"
                autoFocus
                placeholder="Acme English Academy"
                className="w-full rounded-md ring-1 ring-brand-grey-300 bg-white px-3 py-2 font-body text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red"
              />
              <p className="mt-1 font-body text-xs text-brand-grey-500">
                2–120 characters. You can change it later from settings.
              </p>
            </div>

            <div className="flex items-center justify-between gap-3 pt-2">
              <Link
                href="/pricing"
                className="font-body text-sm text-brand-grey-700 hover:text-brand-black underline-offset-4 hover:underline"
              >
                Change plan
              </Link>
              <button
                type="submit"
                className="inline-flex items-center rounded-pill bg-brand-red text-white px-5 py-2.5 font-heading font-bold border border-brand-red transition-colors hover:bg-brand-red-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2"
              >
                {Number(plan.amount_monthly_usd.toString()) === 0
                  ? "Create my workspace"
                  : "Continue to Checkout"}
              </button>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}
