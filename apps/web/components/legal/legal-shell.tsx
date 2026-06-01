import Link from "next/link";
import { Logo } from "@/components/logo";
import { SiteFooter } from "@/components/site-footer";

// Shared chrome + prose primitives for every legal page. Brand-styled per
// .claude/skills/brand-system: black header, white content card, red accents,
// Rubik throughout. Primitives keep the content pages readable and the
// typography consistent (and accessible) without a markdown dependency.

export function LegalShell({
  title,
  effectiveDate,
  version,
  children,
}: {
  title: string;
  effectiveDate: string;
  version: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col bg-brand-grey-50">
      <header className="bg-brand-black text-white">
        <div className="mx-auto max-w-3xl px-6 py-4 flex items-center gap-4">
          <Link
            href="/"
            aria-label="eLanguage Center home"
            className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 focus-visible:ring-offset-brand-black"
          >
            <Logo variant="on-dark" height={32} />
          </Link>
          <Link
            href="/legal"
            className="ml-auto font-heading font-bold text-sm text-brand-grey-200 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 focus-visible:ring-offset-brand-black rounded-sm"
          >
            All policies
          </Link>
        </div>
      </header>

      <main id="main" className="flex-1">
        <div className="mx-auto max-w-3xl px-6 py-12">
          <h1 className="font-heading font-bold text-4xl sm:text-5xl text-brand-black tracking-tight">
            {title}
          </h1>
          <p className="mt-3 font-body text-sm text-brand-grey-500">
            Effective {effectiveDate} · Version {version}
          </p>
          <div className="mt-10 font-body text-brand-grey-900 leading-relaxed">
            {children}
          </div>
          <p className="mt-12 border-t border-brand-grey-200 pt-6 font-body text-sm text-brand-grey-500">
            Questions about this policy? Email{" "}
            <a
              href="mailto:privacy@elanguagecenter.com"
              className="text-brand-red underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red rounded-sm"
            >
              privacy@elanguagecenter.com
            </a>
            .
          </p>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}

// ─── Prose primitives ──────────────────────────────────────────────────────

export function H2({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <h2
      id={id}
      className="font-heading font-bold text-2xl text-brand-black mt-10 mb-3 scroll-mt-24"
    >
      {children}
    </h2>
  );
}

export function H3({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="font-heading font-bold text-lg text-brand-black mt-6 mb-2">
      {children}
    </h3>
  );
}

export function P({ children }: { children: React.ReactNode }) {
  return <p className="my-3 text-brand-grey-900">{children}</p>;
}

export function UL({ children }: { children: React.ReactNode }) {
  return <ul className="my-3 ml-5 list-disc space-y-1.5 text-brand-grey-900">{children}</ul>;
}

export function LI({ children }: { children: React.ReactNode }) {
  return <li>{children}</li>;
}

export function A({ href, children }: { href: string; children: React.ReactNode }) {
  const external = href.startsWith("http") || href.startsWith("mailto:");
  const className =
    "text-brand-red underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red rounded-sm";
  if (external) {
    return (
      <a href={href} className={className} rel="noreferrer" target={href.startsWith("http") ? "_blank" : undefined}>
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

export function DataTable({
  caption,
  head,
  rows,
}: {
  caption: string;
  head: string[];
  rows: React.ReactNode[][];
}) {
  return (
    <div className="my-5 overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b-2 border-brand-black text-left">
            {head.map((h) => (
              <th key={h} className="py-2 pr-4 font-heading font-bold text-brand-black align-bottom">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-brand-grey-200 align-top">
              {row.map((cell, j) => (
                <td key={j} className="py-2 pr-4 text-brand-grey-900">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
