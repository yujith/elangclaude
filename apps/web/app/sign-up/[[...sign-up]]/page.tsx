import type { Metadata } from "next";
import Link from "next/link";
import { SignUp } from "@clerk/nextjs";
import { AuthShell } from "@/components/auth-shell";

const legalLinkClass =
  "text-brand-red-dark underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red rounded-sm";

export const metadata: Metadata = {
  title: "Register",
  description:
    "Register for eLanguage Center — IELTS prep across Reading, Listening, Writing, and Speaking.",
};

// Catch-all route mirrors /sign-in so every Clerk-driven step (email
// verification, MFA enrolment, etc.) keeps a stable URL.
export default function SignUpPage() {
  return (
    <AuthShell
      headline="Skills That Open Doorways."
      subcopy="Start training today. Reading, Listening, Writing, Speaking — AI-generated practice and band-aligned feedback in one place."
    >
      <SignUp
        path="/sign-up"
        routing="path"
        signInUrl="/sign-in"
        fallbackRedirectUrl="/post-signin"
      />
      <p className="mt-4 max-w-sm font-body text-xs text-brand-grey-900">
        By registering you agree to our{" "}
        <Link href="/terms" className={legalLinkClass}>
          Terms of Service
        </Link>{" "}
        and{" "}
        <Link href="/privacy" className={legalLinkClass}>
          Privacy Policy
        </Link>
        .
      </p>
    </AuthShell>
  );
}
