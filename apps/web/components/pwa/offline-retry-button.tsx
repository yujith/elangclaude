"use client";

export function OfflineRetryButton() {
  return (
    <button
      type="button"
      onClick={() => window.location.reload()}
      // Uses brand-red-dark (#CC1239) rather than brand-red (#EE2346): white
      // text on #EE2346 is 4.23:1, below WCAG AA's 4.5:1 for normal text.
      // #CC1239 clears it at 5.66:1. See the AA follow-up in ADR-0019.
      className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-pill bg-brand-red-dark px-6 py-3 font-heading font-bold text-white border border-brand-red-dark transition-colors hover:bg-brand-red focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2"
    >
      Try again
    </button>
  );
}
