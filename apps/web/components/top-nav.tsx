import Link from "next/link";
import { Wordmark } from "./wordmark";

type Item = { label: string; href: string; active?: boolean };

const items: Item[] = [
  { label: "Home", href: "/", active: true },
  { label: "About", href: "/about" },
  { label: "Tests", href: "/tests" },
  { label: "Pricing", href: "/pricing" },
  { label: "Sign in", href: "/sign-in" },
];

export function TopNav() {
  return (
    <nav className="w-full bg-brand-black text-white">
      <div className="mx-auto max-w-7xl px-6 py-5 flex items-center justify-between">
        <Link href="/" className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 focus-visible:ring-offset-brand-black rounded-sm">
          <Wordmark variant="dark" />
        </Link>
        <ul className="hidden md:flex items-center gap-1 font-heading font-bold text-sm">
          {items.map((item) => {
            const base =
              "px-4 py-1.5 rounded-pill transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 focus-visible:ring-offset-brand-black";
            const className = item.active
              ? `${base} border border-brand-red text-white`
              : `${base} border border-transparent text-brand-grey-200 hover:text-white`;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={className}
                  aria-current={item.active ? "page" : undefined}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
