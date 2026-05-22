import Link from "next/link";
import { Logo } from "./logo";
import { CtaLink } from "./cta-link";

const items = [
  { label: "Sections", href: "/#sections" },
  { label: "How it works", href: "/#how" },
  { label: "For orgs", href: "/#orgs" },
  { label: "Pricing", href: "/#pricing" },
];

const navItemClass =
  "px-3 py-1.5 rounded-pill text-brand-grey-200 hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 focus-visible:ring-offset-brand-black";

export function TopNav() {
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
          <Link
            href="/sign-in"
            className="px-3 py-1.5 rounded-pill text-white hover:text-brand-grey-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 focus-visible:ring-offset-brand-black"
          >
            Sign in
          </Link>
          <CtaLink href="/sign-up" variant="outlined" className="!py-2 !px-4 !text-sm">
            Register
          </CtaLink>
        </div>
      </div>
    </nav>
  );
}
