import type { ReactNode } from "react";
import { Logo } from "@/components/logo";

// Two-pane shell for /sign-in and /sign-up. At ≥768px the brand hero owns
// the left half with its contents centered both axes; the Clerk widget
// sits in a centered card on the right. Below 768px the hero collapses
// to a thin top strip carrying just the wordmark (left-aligned to match
// the navbar convention), keeping the form fully visible without a
// vertical scroll on short viewports.
type AuthShellProps = {
  headline: string;
  subcopy: string;
  children: ReactNode;
};

export function AuthShell({ headline, subcopy, children }: AuthShellProps) {
  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      <aside className="bg-brand-black text-brand-white px-6 py-6 md:flex-1 md:py-16 md:px-12 lg:px-20 md:flex md:items-center md:justify-center">
        <div className="md:max-w-lg md:text-center md:flex md:flex-col md:items-center">
          <Logo variant="on-dark" height={48} priority />
          <h1 className="hidden md:block mt-10 font-display italic font-bold text-5xl lg:text-6xl leading-[1.05]">
            {headline}
          </h1>
          <p className="hidden md:block mt-6 font-body text-brand-grey-400 text-lg leading-relaxed">
            {subcopy}
          </p>
        </div>
      </aside>
      <main className="bg-brand-grey-50 md:flex-1 flex items-center justify-center px-6 py-12 md:py-16">
        <div className="w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}
