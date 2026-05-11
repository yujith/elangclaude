import Link from "next/link";
import type { Metadata } from "next";
import { TopNav } from "@/components/top-nav";
import { SiteFooter } from "@/components/site-footer";

const ORG_EMAIL = "hello@elanguagecenter.com";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to eLanguage Center — IELTS prep across Reading, Listening, Writing, and Speaking.",
};

export default function SignInPage() {
  return (
    <>
      <TopNav />
      <main className="flex-1 bg-brand-grey-50">
        <div className="mx-auto max-w-md px-6 py-20 md:py-28">
          <div className="rounded-lg bg-brand-white p-8 md:p-10 ring-1 ring-brand-grey-200">
            <h1 className="font-heading font-bold text-3xl text-brand-black">
              Sign in
            </h1>
            <p className="mt-4 font-body text-base text-brand-grey-700">
              Sign-in is rolling out shortly. Drop us a line and we’ll let you
              know the moment it’s live.
            </p>
            <a
              href={`mailto:${ORG_EMAIL}?subject=Notify%20me%20when%20sign-in%20launches`}
              className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-pill bg-brand-red px-6 py-3 font-heading font-bold text-white border border-brand-red transition-colors hover:bg-brand-red-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2"
            >
              Email me when it’s ready
            </a>
          </div>
          <p className="mt-6 text-center font-body text-sm text-brand-grey-700">
            New here?{" "}
            <Link
              href="/sign-up"
              className="font-heading font-bold text-brand-black underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 rounded-sm"
            >
              Register
            </Link>
          </p>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
