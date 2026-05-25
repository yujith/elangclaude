import Link from "next/link";
import type {
  ResumeAttempt,
  ResumeMockSession,
  Section,
} from "@elc/db";
import { formatRelativeTime } from "@/lib/format/relative-time";

const SECTION_PATH: Record<Section, string> = {
  Reading: "/practice/reading",
  Listening: "/practice/listening",
  Writing: "/practice/writing",
  Speaking: "/practice/speaking",
};

type Props = {
  mockSession: ResumeMockSession | null;
  attempt: ResumeAttempt | null;
  now?: Date;
};

// Subtle accent strip — only the left border is red; no tinted fill.
// Mock takes precedence over a standalone attempt (see ADR-0015 D4).
export function ResumeStrip({ mockSession, attempt, now }: Props) {
  if (!mockSession && !attempt) return null;

  const { href, label, started } = (() => {
    if (mockSession) {
      const section = mockSession.currentSection;
      return {
        href: `/mock/${mockSession.id}`,
        label: section
          ? `Continue your full mock at ${section}.`
          : "Wrap up your full mock.",
        started: mockSession.startedAt,
      };
    }
    const a = attempt!;
    return {
      href: `${SECTION_PATH[a.section]}/${a.id}`,
      label: `Continue your ${a.section.toLowerCase()} attempt.`,
      started: a.startedAt,
    };
  })();

  return (
    <Link
      href={href}
      className="group flex items-center justify-between gap-4 border-l-2 border-brand-red py-3 pl-4 pr-2 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2"
    >
      <div>
        <p className="font-heading font-bold text-base text-brand-black">
          {label}
        </p>
        <p className="font-body text-sm text-brand-grey-700">
          Started {formatRelativeTime(started, now)}.
        </p>
      </div>
      <span className="font-heading font-bold text-sm text-brand-red-dark group-hover:text-brand-black transition-colors">
        Continue <span aria-hidden="true">→</span>
      </span>
    </Link>
  );
}
