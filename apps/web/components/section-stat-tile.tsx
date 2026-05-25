import Link from "next/link";
import type { SectionStat } from "@elc/db";

const HREF: Record<"Reading" | "Listening" | "Writing" | "Speaking", string> = {
  Reading: "/practice/reading",
  Listening: "/practice/listening",
  Writing: "/practice/writing",
  Speaking: "/practice/speaking",
};

function formatBand(b: number | null): string {
  if (b === null) return "—";
  return b.toFixed(1);
}

type Props = {
  section: "Reading" | "Listening" | "Writing" | "Speaking";
  stat: SectionStat;
};

// Flat tile — no card chrome. The whole tile is the entry point for
// that section. "best" line shows only when it differs from latest, so
// a single-attempt section reads quietly with just the latest band.
export function SectionStatTile({ section, stat }: Props) {
  const showBest =
    stat.bestBand !== null && stat.bestBand !== stat.latestBand;
  return (
    <Link
      href={HREF[section]}
      className="group block space-y-2 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2"
    >
      <p className="font-heading font-bold text-sm text-brand-grey-700 group-hover:text-brand-black transition-colors">
        {section}
      </p>
      <p className="font-display italic font-bold text-4xl md:text-5xl text-brand-black leading-none">
        {formatBand(stat.latestBand)}
      </p>
      {showBest ? (
        <p className="font-body text-xs text-brand-grey-700">
          best {formatBand(stat.bestBand)}
        </p>
      ) : null}
    </Link>
  );
}
