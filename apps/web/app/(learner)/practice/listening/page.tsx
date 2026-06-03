import type { Metadata } from "next";
import Link from "next/link";
import { withOrg } from "@elc/db";
import {
  parseListeningContent,
  type ListeningAccent,
  type ListeningContent,
} from "@elc/ai";
import { requireOrgContext } from "@/lib/auth/context";
import { startListeningAttempt } from "@/lib/listening/actions";
import { SubmitButton } from "@/components/ui/submit-button";

export const metadata: Metadata = {
  title: "Listening practice",
};

export const dynamic = "force-dynamic";

type SearchParams = {
  mode?: string;
  difficulty?: string;
  accent?: string;
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

type PickerTest = {
  id: string;
  difficulty: number;
  body_json: unknown;
  _count: { questions: number };
};

type DecoratedTest = PickerTest & { content: ListeningContent };

const ACCENTS: { key: ListeningAccent; label: string }[] = [
  { key: "british", label: "British" },
  { key: "american", label: "American" },
  { key: "australian", label: "Australian" },
  { key: "canadian", label: "Canadian" },
  { key: "new-zealand", label: "New Zealand" },
];

const ACCENT_KEYS = new Set<string>(ACCENTS.map((a) => a.key));

function parseAccent(raw: unknown): ListeningAccent | null {
  return typeof raw === "string" && ACCENT_KEYS.has(raw)
    ? (raw as ListeningAccent)
    : null;
}

function accentLabel(accent: ListeningAccent): string {
  return ACCENTS.find((a) => a.key === accent)?.label ?? accent;
}

function previewOf(text: string, max = 190): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (oneLine.length <= max) return oneLine;
  return oneLine.slice(0, max - 1).trimEnd() + "…";
}

export default async function ListeningPickerPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const ctx = await requireOrgContext();
  const db = withOrg(ctx);
  const sp = await searchParams;
  const mode = parseMode(sp.mode);
  const difficulty = parseDifficulty(sp.difficulty);
  const accent = parseAccent(sp.accent);

  const me = await db.user.findUniqueOrThrow({
    where: { id: ctx.user_id },
    select: { ielts_track: true },
  });

  // Test is a global model. Listening content is identical across tracks
  // (ADR 0007), but the catalog tag is honoured so a learner sees the
  // same surface conventions as Reading/Writing.
  const tests = await db.test.findMany({
    where: {
      section: "Listening",
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
    const content = parseListeningContent(t.body_json);
    if (content) decorated.push({ ...t, content });
  }

  const filtered = decorated.filter((t) => {
    if (difficulty !== null && t.difficulty !== difficulty) return false;
    if (accent) {
      const hasAccent = t.content.parts.some((part) =>
        part.speakers.some((speaker) => speaker.accent === accent),
      );
      if (!hasAccent) return false;
    }
    return true;
  });

  const trackLabel =
    me.ielts_track === "Academic" ? "Academic" : "General Training";
  const hasFilters = difficulty !== null || accent !== null;

  return (
    <section className="px-6 py-12 md:py-16">
      <div className="mx-auto max-w-6xl">
        <header className="mb-8">
          <p className="font-body text-sm uppercase tracking-widest text-brand-red">
            {trackLabel} · Listening
          </p>
          <h1 className="mt-2 font-display italic font-bold text-4xl md:text-5xl text-brand-black leading-tight">
            Tune in. Pick a section.
          </h1>
          <p className="mt-4 font-body text-base text-brand-grey-700 max-w-2xl">
            One full IELTS Listening section: four parts, ~30 minutes of audio,
            mixed question types. Real-exam playback rules — audio plays once
            per part, no transcript, no replay. We&apos;re testing your
            listening skill, not your reading speed.
          </p>
        </header>

        <ModeTabs current={mode} />

        {mode === "mock" ? (
          <FullMockPlaceholder />
        ) : decorated.length === 0 ? (
          <EmptyState trackLabel={trackLabel} />
        ) : (
          <>
            <ListeningFilters
              difficulty={difficulty}
              accent={accent}
              hasFilters={hasFilters}
              total={decorated.length}
              filtered={filtered.length}
            />
            {filtered.length === 0 ? (
              <NoResults />
            ) : (
              <SectionList tests={filtered} trackLabel={trackLabel} />
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
      href: "/practice/listening?mode=section",
      hint: "Full Listening section, real-exam single-play rules.",
    },
    {
      key: "mock",
      label: "Full mock",
      href: "/practice/listening?mode=mock",
      hint: "Exam-day simulation. Coming soon.",
    },
  ];
  return (
    <nav
      aria-label="Listening practice mode"
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

function FullMockPlaceholder() {
  return (
    <div className="rounded-lg bg-brand-white p-8 ring-1 ring-brand-grey-200 space-y-3">
      <p className="font-heading font-bold text-xl text-brand-black">
        Full mocks (timed, single-play) are coming.
      </p>
      <p className="font-body text-base text-brand-grey-700">
        Phase 6 wires the mock-test orchestrator. For now, drill the same
        content in Section practice with pause + rewind enabled.
      </p>
    </div>
  );
}

function ListeningFilters({
  difficulty,
  accent,
  hasFilters,
  total,
  filtered,
}: {
  difficulty: number | null;
  accent: ListeningAccent | null;
  hasFilters: boolean;
  total: number;
  filtered: number;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
      <p className="font-body text-sm text-brand-grey-700">
        Showing {filtered} of {total} sections.
      </p>
      <form
        action="/practice/listening"
        method="get"
        className="grid w-full gap-3 sm:w-auto sm:grid-cols-[minmax(9rem,0.7fr)_minmax(10rem,0.8fr)_auto_auto] sm:items-end"
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
        <FilterSelect label="Accent" name="accent" value={accent ?? ""}>
          <option value="">Any accent</option>
          {ACCENTS.map((a) => (
            <option key={a.key} value={a.key}>
              {a.label}
            </option>
          ))}
        </FilterSelect>
        <button
          type="submit"
          className="inline-flex items-center justify-center rounded-pill bg-brand-red px-5 py-2.5 font-heading font-bold text-sm text-white border border-brand-red transition-colors hover:bg-brand-red-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2"
        >
          Filter
        </button>
        {hasFilters ? (
          <Link
            href="/practice/listening?mode=section"
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

function SectionList({
  tests,
  trackLabel,
}: {
  tests: DecoratedTest[];
  trackLabel: string;
}) {
  return (
    <ul className="space-y-3">
      {tests.map((t) => (
        <SectionRow key={t.id} test={t} trackLabel={trackLabel} />
      ))}
    </ul>
  );
}

function SectionRow({
  test,
  trackLabel,
}: {
  test: DecoratedTest;
  trackLabel: string;
}) {
  const parts = test.content.parts;
  const speakerCount = new Set(
    parts.flatMap((p) => p.speakers.map((s) => s.id + "-" + s.accent)),
  ).size;
  const accents = Array.from(
    new Set(parts.flatMap((p) => p.speakers.map((s) => s.accent))),
  );
  const titles = parts.map((p) => p.title).join(" · ");
  return (
    <li className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 px-5 py-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_11rem] lg:items-center">
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center rounded-pill bg-brand-black text-white font-heading font-bold text-xs px-3 py-1">
              Listening · {trackLabel}
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
              Parts: {previewOf(titles, 120)}
            </h3>
            <p className="mt-1 font-body text-sm text-brand-grey-700 leading-relaxed">
              {accents.map(accentLabel).join(", ")} · {speakerCount} voices
            </p>
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm font-body text-brand-grey-700 sm:grid-cols-5">
            <Metric label="Parts">{parts.length}</Metric>
            <Metric label="Questions">{test._count.questions}</Metric>
            <Metric label="Time">~30 min</Metric>
            <Metric label="Voices">{speakerCount}</Metric>
            <Metric label="Level">{test.difficulty}</Metric>
          </dl>
        </div>
        <form action={startListeningAttempt}>
          <input type="hidden" name="testId" value={test.id} />
          <SubmitButton
            pendingLabel="Starting…"
            className="w-full inline-flex items-center justify-center rounded-pill bg-brand-red px-5 py-3 font-heading font-bold text-white border border-brand-red transition-colors hover:bg-brand-red-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            Start listening
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
        No approved Listening sections yet for {trackLabel}.
      </p>
      <p className="mt-2 font-body text-base text-brand-grey-700">
        Ask your admin to generate + approve a section, or come back once new
        content is live.
      </p>
    </div>
  );
}

function NoResults() {
  return (
    <div className="rounded-lg bg-brand-white p-8 ring-1 ring-brand-grey-200">
      <p className="font-heading font-bold text-lg text-brand-black">
        No Listening sections match those filters.
      </p>
      <p className="mt-2 font-body text-base text-brand-grey-700">
        Clear filters or choose a broader difficulty or accent.
      </p>
    </div>
  );
}
