import Link from "next/link";
import type { Metadata } from "next";
import { TopNav } from "@/components/top-nav";
import { SiteFooter } from "@/components/site-footer";

const ORG_EMAIL = "hello@elanguagecenter.com";

export const metadata: Metadata = {
  title: "Register",
  description: "Register for eLanguage Center — IELTS prep across Reading, Listening, Writing, and Speaking.",
};

export default function SignUpPage() {
  return (
    <>
      <TopNav />
      <main className="flex-1 bg-brand-grey-50">
        <div className="mx-auto max-w-md px-6 py-20 md:py-28">
          <div className="rounded-lg bg-brand-white p-8 md:p-10 ring-1 ring-brand-grey-200">
            <h1 className="font-heading font-bold text-3xl text-brand-black">
              Register
            </h1>
            <p className="mt-4 font-body text-base text-brand-grey-700">
              Self-serve registration is rolling out shortly. Tell us you’re
              interested and we’ll send you a free seat the moment it’s live.
            </p>
            <a
              href={`mailto:${ORG_EMAIL}?subject=I'd%20like%20a%20free%20seat%20when%20it%20launches`}
              className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-pill bg-brand-red px-6 py-3 font-heading font-bold text-white border border-brand-red transition-colors hover:bg-brand-red-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2"
            >
              Email me when it’s ready
            </a>
            <p className="mt-6 font-body text-sm text-brand-grey-500">
              Running an organization?{" "}
              <a
                href={`mailto:${ORG_EMAIL}?subject=eLanguage%20Center%20for%20our%20organization`}
                className="font-heading font-bold text-brand-black underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 rounded-sm"
              >
                Talk to us about seats
              </a>
              .
            </p>
          </div>
          <p className="mt-6 text-center font-body text-sm text-brand-grey-700">
            Already have an account?{" "}
            <Link
              href="/sign-in"
              className="font-heading font-bold text-brand-black underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 rounded-sm"
            >
              Sign in
            </Link>
          </p>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
