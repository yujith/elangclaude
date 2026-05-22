import type { Metadata } from "next";
import { SignUp } from "@clerk/nextjs";
import { TopNav } from "@/components/top-nav";
import { SiteFooter } from "@/components/site-footer";

export const metadata: Metadata = {
  title: "Register",
  description:
    "Register for eLanguage Center — IELTS prep across Reading, Listening, Writing, and Speaking.",
};

// Catch-all route mirrors /sign-in so every Clerk-driven step (email
// verification, MFA enrolment, etc.) keeps a stable URL.
export default function SignUpPage() {
  return (
    <>
      <TopNav />
      <main className="flex-1 bg-brand-grey-50">
        <div className="mx-auto max-w-md px-6 py-16 md:py-24 flex items-center justify-center">
          <SignUp
            path="/sign-up"
            routing="path"
            signInUrl="/sign-in"
            fallbackRedirectUrl="/post-signin"
          />
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
