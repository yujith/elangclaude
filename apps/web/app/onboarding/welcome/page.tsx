import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@elc/db/client";
import { requireRole } from "@/lib/auth/context";

export const metadata: Metadata = {
  title: "Welcome aboard · eLanguage Center",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function OnboardingWelcomePage() {
  const ctx = await requireRole("OrgAdmin");
  const org = await prisma.organization.findUnique({
    where: { id: ctx.org_id },
    select: {
      name: true,
      subscription_status: true,
      trial_end: true,
      plan: { select: { name: true } },
    },
  });

  // Friendly trial-end copy when we know it.
  const trialEnd = org?.trial_end ?? null;
  const trialCopy = trialEnd
    ? `Your trial runs through ${trialEnd.toISOString().slice(0, 10)}. We’ll let you know before it ends.`
    : null;

  return (
    <section className="px-6 py-16 md:py-24">
      <div className="mx-auto max-w-2xl text-center space-y-6">
        <p className="font-body text-sm uppercase tracking-widest text-brand-red">
          You’re in
        </p>
        <h1 className="font-display italic font-bold text-4xl md:text-5xl text-brand-black leading-tight">
          Welcome to eLanguage Center.
        </h1>
        <p className="font-body text-base text-brand-grey-700">
          {org?.name ?? "Your organisation"} is set up
          {org?.plan?.name ? ` on ${org.plan.name}` : ""}. Skills That Open
          Doorways — your learners can start practising as soon as you invite
          them.
        </p>
        {trialCopy ? (
          <p className="font-body text-sm text-brand-grey-700">{trialCopy}</p>
        ) : null}
        <div className="flex flex-wrap items-center justify-center gap-3 pt-4">
          <Link
            href="/admin"
            className="inline-flex items-center rounded-pill bg-brand-red text-white px-6 py-3 font-heading font-bold border border-brand-red transition-colors hover:bg-brand-red-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2"
          >
            Go to your dashboard
          </Link>
          <Link
            href="/profile"
            className="inline-flex items-center rounded-pill bg-brand-white text-brand-black px-6 py-3 font-heading font-bold border border-brand-grey-300 hover:bg-brand-grey-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2"
          >
            Update your profile
          </Link>
        </div>
      </div>
    </section>
  );
}
