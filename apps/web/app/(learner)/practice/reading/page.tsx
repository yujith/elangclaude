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
import { SubmitButton } from "@/components/ui/submit-button";

export const metadata: Metadata = {
  title: "Reading practice",
};

export const dynamic = "force-dynamic";

type SearchParams = {
  mode?: string;
  difficulty?: string;
  gt_section?: string;
};

type Mode = "section" | "mock";

function parseMode(raw: unknown): Mode {
  return raw === "mock" ? "mock" : "section";
}

function parseDifficulty(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 1 && value <= 5 ? value : null;
}

function difficultyDots(level: number): string {
  const filled = Math.max(1, Math.min(5, level));
  return "●".repeat(filled) + "○".repeat(5 - filled);
}

function previewOf(text: string, max = 180): string {
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

type GtSectionKey = GtContext | "uncategorised";

const GT_SECTIONS: { key: GtSectionKey; label: string }[] = [
  { key: "social-survival", label: "Social survival" },
  { key: "workplace", label: "Workplace" },
  { key: "general-reading", label: "General reading" },
  { key: "uncategorised", label: "Uncategorised" },
];

const GT_SECTION_KEYS = new Set<string>(GT_SECTIONS.map((s) => s.key));

function parseGtSection(raw: unknown): GtSectionKey | null {
  return typeof raw === "string" && GT_SECTION_KEYS.has(raw)
    ? (raw as GtSectionKey)
    : null;
}

function gtSectionLabel(key: GtSectionKey): string {
  return GT_SECTIONS.find((s) => s.key === key)?.label ?? "Uncategorised";
}

export default async function ReadingPickerPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const ctx = await requireOrgContext();
  const db = withOrg(ctx);
  const sp = await searchParams;
  const mode = parseMode(sp.mode);
  const difficulty = parseDifficulty(sp.difficulty);

  const me = await db.user.findUniqueOrThrow({
    where: { id: ctx.user_id },
    select: { ielts_track: true },
  });

  const gtSection =
    me.ielts_track === "GeneralTraining" ? parseGtSection(sp.gt_section) : null;

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

  const filtered = decorated.filter((t) => {
    if (difficulty !== null && t.difficulty !== difficulty) return false;
    if (gtSection) {
      const section = (t.passage.gt_context ?? "uncategorised") as GtSectionKey;
      if (section !== gtSection) return false;
    }
    return true;
  });

  const trackLabel =
    me.ielts_track === "Academic" ? "Academic" : "General Training";
  const hasFilters = difficulty !== null || gtSection !== null;

  return (
    <section className="px-6 py-12 md:py-16">
      <div className="mx-auto max-w-6xl">
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
        ) : decorated.length === 0 ? (
          <EmptyState trackLabel={trackLabel} />
        ) : (
          <>
            <ReadingFilters
              difficulty={difficulty}
              gtSection={gtSection}
              showGtSection={me.ielts_track === "GeneralTraining"}
              hasFilters={hasFilters}
              total={decorated.length}
              filtered={filtered.length}
            />
            {filtered.length === 0 ? (
              <NoResults />
            ) : (
              <PassageList
                tests={filtered}
                trackLabel={trackLabel}
                showGtSection={me.ielts_track === "GeneralTraining"}
              />
            )}
          </>
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
      className="mb-8 inline-flex rounded-pill bg-brand-white ring-1 ring-brand-grey-200 p-1"
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

function ReadingFilters({
  difficulty,
  gtSection,
  showGtSection,
  hasFilters,
  total,
  filtered,
}: {
  difficulty: number | null;
  gtSection: GtSectionKey | null;
  showGtSection: boolean;
  hasFilters: boolean;
  total: number;
  filtered: number;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
      <p className="font-body text-sm text-brand-grey-700">
        Showing {filtered} of {total} passages.
      </p>
      <form
        action="/practice/reading"
        method="get"
        className="grid w-full gap-3 sm:w-auto sm:grid-cols-[minmax(9rem,0.7fr)_minmax(11rem,0.9fr)_auto_auto] sm:items-end"
      >
        <input type="hidden" name="mode" value="section" />
        <FilterSelect
          label="Difficulty"
          name="difficulty"
          value={difficulty === null ? "" : String(difficulty)}
        >
          <option value="">Any difficulty</option>
          {[1, 2, 3, 4, 5].map((level) => (
            <option key={level} value={level}>
              Level {level}
            </option>
          ))}
        </FilterSelect>
        {showGtSection ? (
          <FilterSelect
            label="GT section"
            name="gt_section"
            value={gtSection ?? ""}
          >
            <option value="">Any section</option>
            {GT_SECTIONS.map((section) => (
              <option key={section.key} value={section.key}>
                {section.label}
              </option>
            ))}
          </FilterSelect>
        ) : null}
        <button
          type="submit"
          className="inline-flex items-center justify-center rounded-pill bg-brand-red px-5 py-2.5 font-heading font-bold text-sm text-white border border-brand-red transition-colors hover:bg-brand-red-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2"
        >
          Filter
        </button>
        {hasFilters ? (
          <Link
            href="/practice/reading?mode=section"
            className="inline-flex items-center justify-center px-1 py-2 font-body text-sm text-brand-grey-700 underline-offset-4 hover:text-brand-black hover:underline"
          >
            Clear filters
          </Link>
        ) : null}
      </form>
    </div>
  );
}

function FilterSelect({
  label,
  name,
  value,
  children,
}: {
  label: string;
  name: string;
  value: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block font-heading font-bold text-xs uppercase tracking-wide text-brand-grey-600 mb-1">
        {label}
      </span>
      <select
        name={name}
        defaultValue={value}
        className="w-full rounded-md border-0 ring-1 ring-brand-grey-300 bg-white px-3 py-2 font-body text-sm text-brand-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red"
      >
        {children}
      </select>
    </label>
  );
}

function PassageList({
  tests,
  trackLabel,
  showGtSection,
}: {
  tests: DecoratedTest[];
  trackLabel: string;
  showGtSection: boolean;
}) {
  return (
    <ul className="space-y-3">
      {tests.map((t) => (
        <PassageRow
          key={t.id}
          test={t}
          trackLabel={trackLabel}
          showGtSection={showGtSection}
        />
      ))}
    </ul>
  );
}

function PassageRow({
  test,
  trackLabel,
  showGtSection,
}: {
  test: DecoratedTest;
  trackLabel: string;
  showGtSection: boolean;
}) {
  const firstPara = test.passage.paragraphs[0]?.text ?? "";
  const section = (test.passage.gt_context ?? "uncategorised") as GtSectionKey;
  return (
    <li className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 px-5 py-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_11rem] lg:items-center">
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
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
          <div className="min-w-0">
            <h3 className="font-heading font-bold text-lg text-brand-black leading-snug">
              {test.passage.title || "Untitled passage"}
            </h3>
            <p className="mt-1 font-body text-sm text-brand-grey-700 leading-relaxed">
              {previewOf(firstPara)}
            </p>
          </div>
          <dl
            className={
              "grid grid-cols-2 gap-x-6 gap-y-2 text-sm font-body text-brand-grey-700 " +
              (showGtSection ? "sm:grid-cols-4" : "sm:grid-cols-3")
            }
          >
            <Metric label="Questions">{test._count.questions}</Metric>
            <Metric label="Time">20 min</Metric>
            <Metric label="Level">{test.difficulty}</Metric>
            {showGtSection ? (
              <Metric label="Section">{gtSectionLabel(section)}</Metric>
            ) : null}
          </dl>
        </div>
        <form action={startReadingAttempt}>
          <input type="hidden" name="testId" value={test.id} />
          <SubmitButton
            pendingLabel="Starting…"
            className="w-full inline-flex items-center justify-center rounded-pill bg-brand-red px-5 py-3 font-heading font-bold text-white border border-brand-red transition-colors hover:bg-brand-red-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            Start reading
          </SubmitButton>
        </form>
      </div>
    </li>
  );
}

function Metric({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-brand-grey-500">
        {label}
      </dt>
      <dd className="font-heading font-bold text-brand-black">{children}</dd>
    </div>
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

function NoResults() {
  return (
    <div className="rounded-lg bg-brand-white p-8 ring-1 ring-brand-grey-200">
      <p className="font-heading font-bold text-lg text-brand-black">
        No Reading passages match those filters.
      </p>
      <p className="mt-2 font-body text-base text-brand-grey-700">
        Clear filters or choose a broader difficulty or section.
      </p>
    </div>
  );
}
