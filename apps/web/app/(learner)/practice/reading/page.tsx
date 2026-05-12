import type { Metadata } from "next";
import Link from "next/link";
import { withOrg } from "@elc/db";
import {
  parseReadingPassage,
  type GtContext,
  type ReadingPassage,
} from "@elc/ai";
import { requireOrgContext } from "@/lib/auth/context";
import { startReadingAttempt } from "@/lib/reading/actions";

export const metadata: Metadata = {
  title: "Reading practice",
};

export const dynamic = "force-dynamic";

type SearchParams = { mode?: string };

type Mode = "section" | "mock";

function parseMode(raw: unknown): Mode {
  return raw === "mock" ? "mock" : "section";
}

function difficultyDots(level: number): string {
  const filled = Math.max(1, Math.min(5, level));
  return "●".repeat(filled) + "○".repeat(5 - filled);
}

function previewOf(text: string, max = 220): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (oneLine.length <= max) return oneLine;
  return oneLine.slice(0, max - 1).trimEnd() + "…";
}

type PickerTest = {
  id: string;
  difficulty: number;
  body_json: unknown;
  _count: { questions: number };
};

type DecoratedTest = PickerTest & { passage: ReadingPassage };

// IELTS GT Reading section grouping. Each section has a stable key, a
// display heading, and a short hint. "uncategorised" catches GT tests
// that were seeded or generated without a gt_context tag.
type GtSectionKey = GtContext | "uncategorised";

const GT_SECTIONS: { key: GtSectionKey; heading: string; hint: string }[] = [
  {
    key: "social-survival",
    heading: "Section 1 — Social survival",
    hint: "Everyday texts: notices, advertisements, guides aimed at the general public.",
  },
  {
    key: "workplace",
    heading: "Section 2 — Workplace",
    hint: "Work-related texts: memos, training materials, job descriptions.",
  },
  {
    key: "general-reading",
    heading: "Section 3 — General reading",
    hint: "Longer general-interest pieces, slightly more formal.",
  },
  {
    key: "uncategorised",
    heading: "Uncategorised",
    hint: "Passages without a GT section tag yet — moderator can re-tag them later.",
  },
];

export default async function ReadingPickerPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const ctx = await requireOrgContext();
  const db = withOrg(ctx);
  const sp = await searchParams;
  const mode = parseMode(sp.mode);

  const me = await db.user.findUniqueOrThrow({
    where: { id: ctx.user_id },
    select: { ielts_track: true },
  });

  // Test is a global model — withOrg passes through unscoped, which is
  // correct: the content pool is shared across orgs.
  const tests = await db.test.findMany({
    where: {
      section: "Reading",
      status: "Approved",
      track: me.ielts_track,
    },
    select: {
      id: true,
      difficulty: true,
      body_json: true,
      _count: { select: { questions: true } },
    },
    orderBy: [{ difficulty: "asc" }, { createdAt: "asc" }],
  });

  const decorated: DecoratedTest[] = [];
  for (const t of tests) {
    const passage = parseReadingPassage(t.body_json);
    if (passage) decorated.push({ ...t, passage });
  }

  const trackLabel =
    me.ielts_track === "Academic" ? "Academic" : "General Training";

  return (
    <section className="px-6 py-12 md:py-16">
      <div className="mx-auto max-w-5xl">
        <header className="mb-8">
          <p className="font-body text-sm uppercase tracking-widest text-brand-red">
            {trackLabel} · Reading
          </p>
          <h1 className="mt-2 font-display italic font-bold text-4xl md:text-5xl text-brand-black leading-tight">
            Pick a passage. Read sharp.
          </h1>
          <p className="mt-4 font-body text-base text-brand-grey-700 max-w-2xl">
            One passage, ~20 minutes, mixed question types. Your timer is a
            soft guide — your answers autosave as you go and you&apos;ll see a
            per-question breakdown when you submit.
          </p>
        </header>

        <ModeTabs current={mode} />

        {mode === "mock" ? (
          <FullMockPlaceholder track={me.ielts_track} />
        ) : me.ielts_track === "GeneralTraining" ? (
          <GtSectionView
            decorated={decorated}
            trackLabel={trackLabel}
          />
        ) : (
          <FlatPickerView decorated={decorated} trackLabel={trackLabel} />
        )}
      </div>
    </section>
  );
}

function ModeTabs({ current }: { current: Mode }) {
  const tabs: { key: Mode; label: string; href: string; hint: string }[] = [
    {
      key: "section",
      label: "Section practice",
      href: "/practice/reading?mode=section",
      hint: "One passage at a time.",
    },
    {
      key: "mock",
      label: "Full mock",
      href: "/practice/reading?mode=mock",
      hint: "Exam-day simulation. Coming soon.",
    },
  ];
  return (
    <nav
      aria-label="Reading practice mode"
      className="mb-10 inline-flex rounded-pill bg-brand-white ring-1 ring-brand-grey-200 p-1"
    >
      {tabs.map((t) => {
        const active = t.key === current;
        return (
          <Link
            key={t.key}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={
              "inline-flex items-center rounded-pill px-5 py-2 font-heading font-bold text-sm transition-colors " +
              (active
                ? "bg-brand-red text-white"
                : "text-brand-grey-700 hover:text-brand-black")
            }
            title={t.hint}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

function FullMockPlaceholder({
  track,
}: {
  track: "Academic" | "GeneralTraining";
}) {
  const sections =
    track === "Academic"
      ? "three passages back-to-back"
      : "five short texts plus one longer text";
  return (
    <div className="rounded-lg bg-brand-white p-8 ring-1 ring-brand-grey-200 space-y-3">
      <p className="font-heading font-bold text-xl text-brand-black">
        Full mock tests are coming.
      </p>
      <p className="font-body text-base text-brand-grey-700">
        A Full Mock will combine {sections} into one 60-minute timed run, with
        a single submit at the end. It lands in a future release once we wire
        the cross-section attempt model.
      </p>
      <p className="font-body text-sm text-brand-grey-700">
        In the meantime, drill single passages on the{" "}
        <Link
          href="/practice/reading?mode=section"
          className="font-heading font-bold text-brand-red hover:underline"
        >
          Section practice
        </Link>{" "}
        tab.
      </p>
    </div>
  );
}

function FlatPickerView({
  decorated,
  trackLabel,
}: {
  decorated: DecoratedTest[];
  trackLabel: string;
}) {
  if (decorated.length === 0) {
    return <EmptyState trackLabel={trackLabel} />;
  }
  return (
    <ul className="grid grid-cols-1 md:grid-cols-2 gap-5">
      {decorated.map((t) => (
        <PassageCard key={t.id} test={t} trackLabel={trackLabel} />
      ))}
    </ul>
  );
}

function GtSectionView({
  decorated,
  trackLabel,
}: {
  decorated: DecoratedTest[];
  trackLabel: string;
}) {
  if (decorated.length === 0) {
    return <EmptyState trackLabel={trackLabel} />;
  }
  const byKey = new Map<GtSectionKey, DecoratedTest[]>();
  for (const t of decorated) {
    const key = (t.passage.gt_context ?? "uncategorised") as GtSectionKey;
    const list = byKey.get(key) ?? [];
    list.push(t);
    byKey.set(key, list);
  }
  return (
    <div className="space-y-10">
      {GT_SECTIONS.map((section) => {
        const tests = byKey.get(section.key) ?? [];
        if (tests.length === 0) return null;
        return (
          <section key={section.key}>
            <h2 className="font-heading font-bold text-xl text-brand-black">
              {section.heading}
            </h2>
            <p className="mt-1 mb-4 font-body text-sm text-brand-grey-700 max-w-2xl">
              {section.hint}
            </p>
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {tests.map((t) => (
                <PassageCard key={t.id} test={t} trackLabel={trackLabel} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function PassageCard({
  test,
  trackLabel,
}: {
  test: DecoratedTest;
  trackLabel: string;
}) {
  const firstPara = test.passage.paragraphs[0]?.text ?? "";
  return (
    <li className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 p-6 flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center rounded-pill bg-brand-black text-white font-heading font-bold text-xs px-3 py-1">
          Reading · {trackLabel}
        </span>
        <span
          className="font-body text-xs text-brand-grey-500"
          aria-label={`Difficulty ${test.difficulty} of 5`}
          title={`Difficulty ${test.difficulty} of 5`}
        >
          {difficultyDots(test.difficulty)}
        </span>
      </div>
      {test.passage.title ? (
        <h3 className="font-heading font-bold text-xl text-brand-black leading-snug">
          {test.passage.title}
        </h3>
      ) : null}
      <p className="font-body text-sm text-brand-grey-700 leading-relaxed">
        {previewOf(firstPara)}
      </p>
      <dl className="grid grid-cols-2 gap-3 text-sm font-body text-brand-grey-700">
        <div>
          <dt className="text-xs uppercase tracking-wide text-brand-grey-500">
            Questions
          </dt>
          <dd className="font-heading font-bold text-brand-black">
            {test._count.questions}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-brand-grey-500">
            Time
          </dt>
          <dd className="font-heading font-bold text-brand-black">20 min</dd>
        </div>
      </dl>
      <form action={startReadingAttempt} className="mt-auto">
        <input type="hidden" name="testId" value={test.id} />
        <button
          type="submit"
          className="w-full inline-flex items-center justify-center gap-2 rounded-pill bg-brand-red px-5 py-3 font-heading font-bold text-white border border-brand-red transition-colors hover:bg-brand-red-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2"
        >
          Start reading
        </button>
      </form>
    </li>
  );
}

function EmptyState({ trackLabel }: { trackLabel: string }) {
  return (
    <div className="rounded-lg bg-brand-white p-8 ring-1 ring-brand-grey-200">
      <p className="font-heading font-bold text-lg text-brand-black">
        No approved Reading passages yet for {trackLabel}.
      </p>
      <p className="mt-2 font-body text-base text-brand-grey-700">
        Ask your admin to seed content, or come back once new passages have
        been approved.
      </p>
    </div>
  );
}
