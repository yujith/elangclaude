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
  { label: "Mock", href: "/mock" },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === "/mock") {
    return pathname === "/mock" || pathname.startsWith("/mock/");
  }
  return pathname.startsWith(href);
}

type Props = {
  className?: string;
};

export function LearnerNav({ className }: Props) {
  const pathname = usePathname();
  return (
    <nav className={className} aria-label="Practice sections">
      <ul className="flex items-center gap-1 list-none p-0">
        {ITEMS.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`relative inline-flex items-center px-3 py-2 font-heading font-bold text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 focus-visible:ring-offset-brand-black rounded-sm ${
                  active
                    ? "text-white"
                    : "text-brand-grey-200 hover:text-white"
                }`}
              >
                {item.label}
                {active ? (
                  <span
                    aria-hidden="true"
                    className="absolute left-3 right-3 -bottom-0.5 h-0.5 bg-brand-red"
                  />
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
