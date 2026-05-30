import Link from "next/link";
import { cookies } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/dev-session";
import { Logo } from "./logo";
import { CtaLink } from "./cta-link";
import { SignOutControl } from "./sign-out-control";

const items = [
  { label: "Sections", href: "/#sections" },
  { label: "How it works", href: "/#how" },
  { label: "For orgs", href: "/#orgs" },
  { label: "Pricing", href: "/pricing" },
];

const navItemClass =
  "px-3 py-1.5 rounded-pill text-brand-grey-200 hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 focus-visible:ring-offset-brand-black";

const accountItemClass =
  "px-3 py-1.5 rounded-pill text-white hover:text-brand-grey-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 focus-visible:ring-offset-brand-black";

async function hasActiveSession(): Promise<boolean> {
  const { userId } = await auth();
  if (userId) return true;

  if (process.env.NODE_ENV === "production") return false;

  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  return Boolean(token && verifySessionToken(token));
}

export async function TopNav() {
  const isSignedIn = await hasActiveSession();

  return (
    <nav className="w-full bg-brand-black text-white sticky top-0 z-30 border-b border-brand-grey-900">
      <div className="mx-auto max-w-7xl px-6 py-4 flex items-center justify-between gap-6">
        <Link
          href="/"
          aria-label="eLanguage Center home"
          className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 focus-visible:ring-offset-brand-black"
        >
          <Logo variant="on-dark" height={40} priority />
        </Link>
        <ul className="hidden lg:flex items-center gap-1 font-heading font-bold text-sm">
          {items.map((item) => (
            <li key={item.href}>
              <Link href={item.href} className={navItemClass}>
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-2 sm:gap-3 font-heading font-bold text-sm">
          {isSignedIn ? (
            <>
              <Link href="/profile" className={accountItemClass}>
                Profile
              </Link>
              <SignOutControl className={accountItemClass} />
            </>
          ) : (
            <>
              <Link href="/sign-in" className={accountItemClass}>
                Sign in
              </Link>
              <CtaLink
                href="/pricing"
                variant="outlined"
                className="!py-2 !px-4 !text-sm"
              >
                Start your school
              </CtaLink>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}
