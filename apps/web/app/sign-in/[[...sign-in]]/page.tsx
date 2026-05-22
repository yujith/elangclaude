import type { Metadata } from "next";
import { SignIn } from "@clerk/nextjs";
import { TopNav } from "@/components/top-nav";
import { SiteFooter } from "@/components/site-footer";

export const metadata: Metadata = {
  title: "Sign in",
  description:
    "Sign in to eLanguage Center — IELTS prep across Reading, Listening, Writing, and Speaking.",
};

// Catch-all route is required by Clerk for the hosted account portal flow
// (forgot password, MFA, factor selection) so every step keeps a stable URL.
export default function SignInPage() {
  return (
    <>
      <TopNav />
      <main className="flex-1 bg-brand-grey-50">
        <div className="mx-auto max-w-md px-6 py-16 md:py-24 flex items-center justify-center">
          <SignIn
            path="/sign-in"
            routing="path"
            signUpUrl="/sign-up"
            fallbackRedirectUrl="/post-signin"
          />
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
