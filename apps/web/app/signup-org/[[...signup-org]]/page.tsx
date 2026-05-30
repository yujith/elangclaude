import type { Metadata } from "next";
import { SignUp } from "@clerk/nextjs";
import { getActivePlanBySlugForCustomer } from "@elc/db";
import { AuthShell } from "@/components/auth-shell";

export const metadata: Metadata = {
  title: "Start your school · eLanguage Center",
  description:
    "Create your eLanguage Center workspace. AI-graded IELTS practice for your learners across Reading, Listening, Writing, and Speaking.",
};

export const dynamic = "force-dynamic";

type SearchParams = { plan?: string };

// Catch-all so Clerk's email-verification, MFA, and continuation steps
// all keep a stable URL under /signup-org. After sign-up Clerk hands the
// user back to `/signup-org/continue?plan={slug}` where we capture the
// org name and finish provisioning.
export default async function SignupOrgPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const slug =
    typeof sp.plan === "string" && sp.plan.length > 0 ? sp.plan : null;

  // Validate the plan exists + is selectable before we even render the
  // Clerk widget. A typo'd slug shouldn't get the visitor stuck after a
  // full sign-up only to discover the plan is gone.
  const plan = slug ? await getActivePlanBySlugForCustomer(slug) : null;
  const continueTarget = plan
    ? `/signup-org/continue?plan=${encodeURIComponent(plan.slug)}`
    : "/signup-org/continue";

  const headline = plan
    ? `Start with ${plan.name}.`
    : "Skills That Open Doorways.";
  const subcopy = plan
    ? `${plan.trial_days > 0 ? `${plan.trial_days}-day trial — change plans any time. ` : ""}Create your eLanguage Center workspace in a couple of minutes.`
    : "Create your eLanguage Center workspace. AI-graded IELTS practice for your learners across Reading, Listening, Writing, and Speaking.";

  return (
    <AuthShell headline={headline} subcopy={subcopy}>
      <SignUp
        path="/signup-org"
        routing="path"
        signInUrl="/sign-in"
        forceRedirectUrl={continueTarget}
        fallbackRedirectUrl={continueTarget}
      />
    </AuthShell>
  );
}
