import Link from "next/link";
import { Logo } from "./logo";

const ORG_EMAIL = "hello@elanguagecenter.com";

type Column = {
  heading: string;
  links: { label: string; href: string }[];
};

const columns: Column[] = [
  {
    heading: "Product",
    links: [
      { label: "The four sections", href: "/#sections" },
      { label: "How it works", href: "/#how" },
      { label: "Pricing", href: "/#pricing" },
      { label: "FAQ", href: "/#faq" },
    ],
  },
  {
    heading: "For organizations",
    links: [
      { label: "Talk to us", href: `mailto:${ORG_EMAIL}` },
      { label: "Run IELTS at scale", href: "/#orgs" },
      { label: "Pricing", href: "/#pricing" },
    ],
  },
  {
    heading: "Account",
    links: [
      { label: "Sign in", href: "/sign-in" },
      { label: "Register", href: "/sign-up" },
    ],
  },
  {
    heading: "Legal",
    links: [
      { label: "Privacy Policy", href: "/privacy" },
      { label: "Terms of Service", href: "/terms" },
      { label: "Cookie Policy", href: "/cookies" },
      { label: "Sub-processors", href: "/sub-processors" },
      { label: "Manage your data", href: "/profile" },
    ],
  },
];

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  const isExternal = href.startsWith("mailto:") || href.startsWith("http");
  const className =
    "font-body text-sm text-brand-grey-200 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 focus-visible:ring-offset-brand-black rounded-sm";
  if (isExternal) {
    return (
      <a href={href} className={className}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}

export function SiteFooter() {
  return (
    <footer className="bg-brand-black text-white border-t-2 border-brand-red">
      <div className="mx-auto max-w-7xl px-6 py-16 grid gap-12 md:grid-cols-[1.2fr_2fr]">
        <div className="flex flex-col gap-4">
          <Logo variant="on-dark" height={32} />
          <p className="font-body text-sm text-brand-grey-400 max-w-xs">
            Built for IELTS Academic and General Training. AI-generated practice,
            AI-graded feedback.
          </p>
        </div>
        <div className="grid gap-10 sm:grid-cols-2 md:grid-cols-4">
          {columns.map((col) => (
            <div key={col.heading} className="flex flex-col gap-3">
              <h3 className="font-heading font-bold text-sm uppercase tracking-[0.15em] text-white">
                {col.heading}
              </h3>
              <ul className="flex flex-col gap-2">
                {col.links.map((link) => (
                  <li key={link.href + link.label}>
                    <FooterLink href={link.href}>{link.label}</FooterLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
      <div className="border-t border-brand-grey-900">
        <div className="mx-auto max-w-7xl px-6 py-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
          <p className="font-body text-xs text-brand-grey-500">
            © {new Date().getFullYear()} eLanguage Center. All rights reserved.
          </p>
          <p className="font-body text-xs text-brand-grey-500">
            Skills That Open Doorways.
          </p>
        </div>
      </div>
    </footer>
  );
}
