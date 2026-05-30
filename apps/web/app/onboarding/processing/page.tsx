import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { prisma } from "@elc/db/client";
import { requireRole } from "@/lib/auth/context";
import { reconcileFromCheckoutSession } from "@/lib/onboarding/reconcile";
import { PollingRefresher } from "./polling-refresher";

export const metadata: Metadata = {
  title: "Setting up… · eLanguage Center",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

// We treat anything that isn't PendingPayment as "we have arrived". The
// (onboarding) layout already bounces non-PendingPayment Orgs out of
// the wizard, but the processing page is the one place we want to
// short-circuit *into* /welcome rather than /admin, so we check here
// explicitly.
const READY_STATES = new Set([
  "Trialing",
  "Active",
  "Internal",
]);

type SearchParams = { session_id?: string };

export default async function OnboardingProcessingPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const ctx = await requireRole("OrgAdmin");
  const sp = await searchParams;
  const sessionId =
    typeof sp.session_id === "string" && sp.session_id.startsWith("cs_")
      ? sp.session_id
      : null;

  let org = await prisma.organization.findUnique({
    where: { id: ctx.org_id },
    select: { subscription_status: true },
  });
  // Layout already bounces if the Org row vanished — defensive only.
  if (!org) redirect("/no-access");

  // Webhook fallback: if the Org is still PendingPayment and we have a
  // session_id from Stripe's success_url, reconcile directly from
  // Stripe so the wizard completes even when `stripe listen` isn't
  // running (typical dev story) or webhook delivery is delayed.
  if (org.subscription_status === "PendingPayment" && sessionId) {
    const result = await reconcileFromCheckoutSession(ctx.org_id, sessionId);
    if (result.kind === "applied") {
      org = await prisma.organization.findUnique({
        where: { id: ctx.org_id },
        select: { subscription_status: true },
      });
      if (!org) redirect("/no-access");
    }
  }

  if (READY_STATES.has(org.subscription_status)) {
    redirect("/onboarding/welcome");
  }

  return (
    <section className="px-6 py-16 md:py-24">
      <div className="mx-auto max-w-xl text-center space-y-6">
        <p className="font-body text-sm uppercase tracking-widest text-brand-red">
          Almost there
        </p>
        <h1 className="font-display italic font-bold text-3xl md:text-4xl text-brand-black leading-tight">
          Setting up your subscription…
        </h1>
        <p className="font-body text-base text-brand-grey-700">
          We’re waiting on confirmation from Stripe. This usually takes a few
          seconds — you don’t need to do anything. The page will refresh
          automatically once your trial is live.
        </p>
        <div
          className="mx-auto h-1.5 w-32 overflow-hidden rounded-full bg-brand-grey-200"
          role="progressbar"
          aria-label="Activating subscription"
        >
          <div className="h-full w-1/3 bg-brand-red animate-pulse" />
        </div>
      </div>
      <PollingRefresher />
    </section>
  );
}
