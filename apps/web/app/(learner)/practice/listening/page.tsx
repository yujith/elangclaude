import type { Metadata } from "next";
import Link from "next/link";
import { withOrg } from "@elc/db";
import { parseListeningContent, type ListeningContent } from "@elc/ai";
import { requireOrgContext } from "@/lib/auth/context";
import { startListeningAttempt } from "@/lib/listening/actions";

export const metadata: Metadata = {
  title: "Listening practice",
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

type PickerTest = {
  id: string;
  difficulty: number;
  body_json: unknown;
  _count: { questions: number };
};

type DecoratedTest = PickerTest & { content: ListeningContent };

export default async function ListeningPickerPage({
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

  const trackLabel =
    me.ielts_track === "Academic" ? "Academic" : "General Training";

  return (
    <section className="px-6 py-12 md:py-16">
      <div className="mx-auto max-w-5xl">
        <header className="mb-8">
          <p className="font-body text-sm uppercase tracking-widest text-brand-red">
            {trackLabel} · Listening
          </p>
          <h1 className="mt-2 font-display italic font-bold text-4xl md:text-5xl text-brand-black leading-tight">
            Tune in. Pick a section.
          </h1>
          <p className="mt-4 font-body text-base text-brand-grey-700 max-w-2xl">
            One full IELTS Listening section: four parts, ~30 minutes of audio,
            mixed question types. Practice mode lets you pause and rewind; the
            timed exam-day mode lands in a later release.
          </p>
        </header>

        <ModeTabs current={mode} />

        {mode === "mock" ? (
          <FullMockPlaceholder />
        ) : decorated.length === 0 ? (
          <EmptyState trackLabel={trackLabel} />
        ) : (
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {decorated.map((t) => (
              <SectionCard key={t.id} test={t} trackLabel={trackLabel} />
            ))}
          </ul>
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
      hint: "Full Listening section, pause + rewind allowed.",
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

function SectionCard({
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
    <li className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 p-6 flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
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
      <h3 className="font-heading font-bold text-lg text-brand-black leading-snug">
        Parts: {titles}
      </h3>
      <p className="font-body text-sm text-brand-grey-700">
        {accents.length} accent{accents.length === 1 ? "" : "s"} ·{" "}
        {speakerCount} voices
      </p>
      <dl className="grid grid-cols-3 gap-3 text-sm font-body text-brand-grey-700">
        <div>
          <dt className="text-xs uppercase tracking-wide text-brand-grey-500">
            Parts
          </dt>
          <dd className="font-heading font-bold text-brand-black">
            {parts.length}
          </dd>
        </div>
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
          <dd className="font-heading font-bold text-brand-black">~30 min</dd>
        </div>
      </dl>
      <form action={startListeningAttempt} className="mt-auto">
        <input type="hidden" name="testId" value={test.id} />
        <button
          type="submit"
          className="w-full inline-flex items-center justify-center gap-2 rounded-pill bg-brand-red px-5 py-3 font-heading font-bold text-white border border-brand-red transition-colors hover:bg-brand-red-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2"
        >
          Start listening
        </button>
      </form>
    </li>
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
