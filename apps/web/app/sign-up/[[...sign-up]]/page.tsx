import type { Metadata } from "next";
import { SignUp } from "@clerk/nextjs";
import { AuthShell } from "@/components/auth-shell";

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
    </AuthShell>
  );
}
