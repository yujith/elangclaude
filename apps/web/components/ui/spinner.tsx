// Brand-aligned loading spinner. Pure presentation — no client directive
// needed, so it renders in Server and Client Components alike.
//
// Brand rule (.claude/rules/brand.md): the moving arc is brand-red on a
// neutral-grey track; no new accent colour. Honours prefers-reduced-motion via
// `motion-reduce:animate-none` so the arc stops spinning but stays visible.
//
// Accessibility: wrapped in role="status" with a visually-hidden label so
// screen readers announce work-in-progress. Pass `label` to override the
// announced text (e.g. "Generating test"). When the spinner sits next to its
// own visible text (as in SubmitButton), pass `decorative` to drop the role so
// the surrounding control owns the announcement instead.

import * as React from "react";

type Size = "sm" | "md" | "lg";

const sizeClasses: Record<Size, string> = {
  sm: "h-4 w-4 border-2",
  md: "h-6 w-6 border-2",
  lg: "h-9 w-9 border-[3px]",
};

type Props = {
  size?: Size;
  label?: string;
  /** Render as a decorative element (no role/label) when an ancestor already announces busy state. */
  decorative?: boolean;
  className?: string;
};

export function Spinner({
  size = "md",
  label = "Loading…",
  decorative = false,
  className,
}: Props) {
  // A bordered circle with one transparent edge spun via animate-spin reads as
  // a ring spinner without needing an SVG. brand-red top edge, grey track.
  const ring = [
    "inline-block shrink-0 rounded-full animate-spin motion-reduce:animate-none",
    "border-brand-grey-200 border-t-brand-red",
    sizeClasses[size],
    className,
  ]
    .filter(Boolean)
    .join(" ");

  if (decorative) {
    return <span aria-hidden="true" className={ring} />;
  }

  return (
    <span role="status" className="inline-flex items-center">
      <span className={ring} />
      <span className="sr-only">{label}</span>
    </span>
  );
}
