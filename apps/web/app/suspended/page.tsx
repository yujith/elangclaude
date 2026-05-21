import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/logo";

export const metadata: Metadata = {
  title: "Organisation paused · eLanguage Center",
  robots: { index: false, follow: false },
};

const STATUS_COPY: Record<string, { headline: string; body: string }> = {
  Suspended: {
    headline: "Your organisation is paused.",
    body: "Practice and admin tools are temporarily unavailable while your organisation is paused. Contact your administrator or eLanguage Center support to restore access.",
  },
  Archived: {
    headline: "Your organisation is closed.",
    body: "This organisation has been archived and is no longer active. Please contact eLanguage Center support if you believe this is in error.",
  },
};

const FALLBACK = {
  headline: "Access is unavailable.",
  body: "Your organisation is not currently active. Contact your administrator or eLanguage Center support to restore access.",
};

export default async function SuspendedPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const sp = await searchParams;
  const copy =
    sp.status && STATUS_COPY[sp.status] ? STATUS_COPY[sp.status] : FALLBACK;

  return (
    <div className="min-h-screen flex flex-col bg-brand-grey-50">
      <header className="bg-brand-black text-white">
        <div className="mx-auto max-w-7xl px-6 py-3">
          <Link
            href="/"
            className="inline-flex items-center gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 focus-visible:ring-offset-brand-black rounded-sm"
          >
            <Logo variant="on-dark" height={36} />
          </Link>
        </div>
      </header>
      <main className="flex-1 px-6 py-16 md:py-24">
        <div className="mx-auto max-w-2xl text-center">
          <p className="font-body text-sm uppercase tracking-widest text-brand-red">
            Access paused
          </p>
          <h1 className="mt-3 font-display italic font-bold text-4xl md:text-5xl text-brand-black leading-tight">
            {copy.headline}
          </h1>
          <p className="mt-6 font-body text-base md:text-lg text-brand-grey-700">
            {copy.body}
          </p>
          <p className="mt-8 font-body text-sm text-brand-grey-500">
            Need help?{" "}
            <a
              href="mailto:support@elanguage.center"
              className="text-brand-black underline underline-offset-4 hover:text-brand-red"
            >
              support@elanguage.center
            </a>
          </p>
        </div>
      </main>
    </div>
  );
}
