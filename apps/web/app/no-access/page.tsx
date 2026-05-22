// Landing page for Clerk-authed users who aren't on any org's roster
// (no DB row, or their row was soft-deleted). Sending them back to
// /sign-in would just loop — Clerk would re-authenticate them and our
// loader would re-throw — so we stop here with a clear message + a
// Clerk sign-out button so they can switch accounts.

import type { Metadata } from "next";
import Link from "next/link";
import { SignOutButton } from "@clerk/nextjs";
import { TopNav } from "@/components/top-nav";
import { SiteFooter } from "@/components/site-footer";

const ORG_EMAIL = "hello@elanguagecenter.com";

export const metadata: Metadata = {
  title: "Access pending",
  description: "Your eLanguage Center account is not on any organisation roster yet.",
  robots: { index: false, follow: false },
};

export default function NoAccessPage() {
  return (
    <>
      <TopNav />
      <main className="flex-1 bg-brand-grey-50">
        <div className="mx-auto max-w-md px-6 py-20 md:py-28">
          <div className="rounded-lg bg-brand-white p-8 md:p-10 ring-1 ring-brand-grey-200">
            <p className="font-body text-sm uppercase tracking-widest text-brand-red">
              Access pending
            </p>
            <h1 className="mt-3 font-heading font-bold text-3xl text-brand-black">
              You&apos;re signed in, but not on a roster yet
            </h1>
            <p className="mt-4 font-body text-base text-brand-grey-700">
              Your eLanguage Center account isn&apos;t linked to any organisation. Ask
              your administrator to invite you, then sign in again with the same
              email address.
            </p>
            <Link
              href="/create-org"
              className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-pill bg-brand-red px-6 py-3 font-heading font-bold text-white border border-brand-red transition-colors hover:bg-brand-red-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2"
            >
              Create my own organisation
            </Link>
            <p className="mt-4 font-body text-sm text-brand-grey-500 text-center">
              Running a school, agency, or training program? Set up your own
              workspace and start inviting learners.
            </p>
            <div className="mt-6 pt-6 border-t border-brand-grey-200">
              <a
                href={`mailto:${ORG_EMAIL}?subject=Help%20accessing%20my%20account`}
                className="block text-center font-body text-sm text-brand-grey-700 hover:text-brand-red underline-offset-4 hover:underline"
              >
                Or email support if you were expecting an invitation
              </a>
            </div>
            <div className="mt-4">
              <SignOutButton redirectUrl="/">
                <button
                  type="button"
                  className="w-full inline-flex items-center justify-center gap-2 rounded-pill bg-brand-white px-6 py-3 font-heading font-bold text-brand-black border border-brand-grey-200 hover:bg-brand-grey-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2"
                >
                  Sign out
                </button>
              </SignOutButton>
            </div>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
