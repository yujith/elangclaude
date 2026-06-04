"use client";

// Inline section nav for the learner header. Lives on the black header
// bar (see (learner)/layout.tsx) so the dashboard body stays calm.
// usePathname forces this to be a client component.

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { label: "Reading", href: "/practice/reading" },
  { label: "Listening", href: "/practice/listening" },
  { label: "Writing", href: "/practice/writing" },
  { label: "Speaking", href: "/practice/speaking" },
  // Full Mock is temporarily hidden while its design is reworked — the
  // routes are gated by app/(learner)/mock/layout.tsx. Restore this item
  // (and remove that layout) to bring the section back.
  { label: "Profile", href: "/profile" },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === "/profile") {
    return pathname === "/profile" || pathname.startsWith("/profile/");
  }
  return pathname.startsWith(href);
}

type Props = {
  className?: string;
};

export function LearnerNav({ className }: Props) {
  const pathname = usePathname();
  return (
    <nav className={className} aria-label="Learner menu">
      <ul className="flex items-center gap-6 list-none p-0">
        {ITEMS.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className="font-heading font-bold text-sm text-white hover:text-brand-red transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 focus-visible:ring-offset-brand-black rounded-sm"
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
