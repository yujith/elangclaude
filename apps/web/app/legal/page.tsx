import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/logo";
import { SiteFooter } from "@/components/site-footer";
import { POLICY_LIST } from "@/lib/legal/policies";

export const metadata: Metadata = {
  title: "Policies",
  description:
    "Privacy Policy, Terms of Service, Cookie Policy, Data Processing Addendum, and sub-processors for eLanguage Center.",
};

export default function LegalIndexPage() {
  return (
    <div className="min-h-screen flex flex-col bg-brand-grey-50">
      <header className="bg-brand-black text-white">
        <div className="mx-auto max-w-3xl px-6 py-4 flex items-center">
          <Link
            href="/"
            aria-label="eLanguage Center home"
            className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 focus-visible:ring-offset-brand-black"
          >
            <Logo variant="on-dark" height={32} />
          </Link>
        </div>
      </header>

      <main id="main" className="flex-1">
        <div className="mx-auto max-w-3xl px-6 py-12">
          <h1 className="font-heading font-bold text-4xl sm:text-5xl text-brand-black tracking-tight">
            Policies
          </h1>
          <p className="mt-4 font-body text-brand-grey-900 leading-relaxed max-w-2xl">
            How we handle your data, the terms of using eLanguage Center, and the
            third parties we rely on. These policies are written to meet the
            GDPR and UK GDPR, Australia&rsquo;s Privacy Act, and the data
            protection laws of South and Southeast Asia.
          </p>

          <ul className="mt-10 grid gap-4">
            {POLICY_LIST.map((p) => (
              <li key={p.slug}>
                <Link
                  href={`/${p.slug}`}
                  className="block rounded-xl border border-brand-grey-200 bg-white p-5 hover:border-brand-red transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red"
                >
                  <span className="font-heading font-bold text-lg text-brand-black">
                    {p.title}
                  </span>
                  <span className="block mt-1 font-body text-sm text-brand-grey-500">
                    {p.summary}
                  </span>
                </Link>
              </li>
            ))}
          </ul>

          <div className="mt-10 rounded-xl bg-brand-black text-white p-6">
            <h2 className="font-heading font-bold text-xl">Your data, your control</h2>
            <p className="mt-2 font-body text-brand-grey-200 leading-relaxed">
              Want a copy of your data, a correction, or your account erased?
              Signed-in learners can do all of that from their profile.
            </p>
            <Link
              href="/profile"
              className="mt-4 inline-block rounded-pill bg-brand-red px-5 py-2.5 font-heading font-bold text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-brand-black"
            >
              Manage your data
            </Link>
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
