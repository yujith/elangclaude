import type { Metadata } from "next";
import { SignIn } from "@clerk/nextjs";
import { AuthShell } from "@/components/auth-shell";

export const metadata: Metadata = {
  title: "Sign in",
  description:
    "Sign in to eLanguage Center — IELTS prep across Reading, Listening, Writing, and Speaking.",
};

// Catch-all route is required by Clerk for the hosted account portal flow
// (forgot password, MFA, factor selection) so every step keeps a stable URL.
export default function SignInPage() {
  return (
    <AuthShell
      headline="Skills That Open Doorways."
      subcopy="IELTS practice across Reading, Listening, Writing, and Speaking. AI-generated. AI-graded. Built for the score you actually need."
    >
      <SignIn
        path="/sign-in"
        routing="path"
        signUpUrl="/sign-up"
        fallbackRedirectUrl="/post-signin"
      />
    </AuthShell>
  );
}
