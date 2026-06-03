import type { Metadata } from "next";
import Link from "next/link";
import { withOrg } from "@elc/db";
import { requireOrgContext } from "@/lib/auth/context";
import {
  parseSpeakingContent,
  type SpeakingContent,
} from "@/lib/speaking/content";
import { startSpeakingAttempt } from "@/lib/speaking/actions";
import { SubmitButton } from "@/components/ui/submit-button";

export const metadata: Metadata = {
  title: "Speaking practice",
};

export const dynamic = "force-dynamic";

type SearchParams = {
  difficulty?: string;
  domain?: string;
};

function parseDifficulty(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 1 && value <= 5 ? value : null;
}

function parseDomain(raw: unknown, domains: string[]): string | null {
  return typeof raw === "string" && domains.includes(raw) ? raw : null;
}

function difficultyDots(level: number): string {
  const filled = Math.max(1, Math.min(5, level));
  return "●".repeat(filled) + "○".repeat(5 - filled);
}

type DecoratedTest = {
  id: string;
  difficulty: number;
  content: SpeakingContent | null;
};

export default async function SpeakingPickerPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const ctx = await requireOrgContext();
  const db = withOrg(ctx);
  const sp = await searchParams;
  const difficulty = parseDifficulty(sp.difficulty);

  // IELTS Speaking content is identical across tracks (ADR 0006 D3) — the
  // picker does NOT filter by track, unlike Reading/Writing. Every approved
  // Speaking test is offered to every learner.
  const tests = await db.test.findMany({
    where: {
      section: "Speaking",
      status: "Approved",
    },
    select: {
      id: true,
      difficulty: true,
      body_json: true,
    },
    orderBy: [{ difficulty: "asc" }, { createdAt: "asc" }],
  });

  const decorated: DecoratedTest[] = tests.map((t) => ({
    id: t.id,
    difficulty: t.difficulty,
    content: parseSpeakingContent(t.body_json),
  }));
  const domains = Array.from(
    new Set(
      decorated
        .map((t) => t.content?.topic_domain)
        .filter((domain): domain is string => Boolean(domain)),
    ),
  ).sort((a, b) => a.localeCompare(b));
  const domain = parseDomain(sp.domain, domains);

  const filtered = decorated.filter((t) => {
    if (difficulty !== null && t.difficulty !== difficulty) return false;
    if (domain && t.content?.topic_domain !== domain) return false;
    return true;
  });
  const hasFilters = difficulty !== null || domain !== null;

  return (
    <section className="px-6 py-12 md:py-16">
      <div className="mx-auto max-w-6xl">
        <header className="mb-8">
          <p className="font-body text-sm uppercase tracking-widest text-brand-red">
            Speaking
          </p>
          <h1 className="mt-2 font-display italic font-bold text-4xl md:text-5xl text-brand-black leading-tight">
            Pick a test. Talk to the examiner.
          </h1>
          <p className="mt-4 font-body text-base text-brand-grey-700 max-w-2xl">
            An IELTS Speaking test is a 3-part voice conversation:
            <strong className="font-heading font-bold"> Part 1</strong> a short
            interview, <strong className="font-heading font-bold"> Part 2</strong>{" "}
            a 1–2 minute long turn from a cue card, and{" "}
            <strong className="font-heading font-bold">Part 3</strong> an
            abstract discussion. You will need microphone access and a quiet
            room. Aim for ~12 minutes end to end.
          </p>
        </header>

        {decorated.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            <SpeakingFilters
              difficulty={difficulty}
              domain={domain}
              domains={domains}
              hasFilters={hasFilters}
              total={decorated.length}
              filtered={filtered.length}
            />
            {filtered.length === 0 ? (
              <NoResults />
            ) : (
              <TestList tests={filtered} />
            )}
          </>
        )}
      </div>
    </section>
  );
}

function SpeakingFilters({
  difficulty,
  domain,
  domains,
  hasFilters,
  total,
  filtered,
}: {
  difficulty: number | null;
  domain: string | null;
  domains: string[];
  hasFilters: boolean;
  total: number;
  filtered: number;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
      <p className="font-body text-sm text-brand-grey-700">
        Showing {filtered} of {total} tests.
      </p>
      <form
        action="/practice/speaking"
        method="get"
        className="grid w-full gap-3 sm:w-auto sm:grid-cols-[minmax(9rem,0.7fr)_minmax(12rem,1fr)_auto_auto] sm:items-end"
      >
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
        <FilterSelect label="Domain" name="domain" value={domain ?? ""}>
          <option value="">Any domain</option>
          {domains.map((d) => (
            <option key={d} value={d}>
              {d}
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
            href="/practice/speaking"
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

function TestList({ tests }: { tests: DecoratedTest[] }) {
  return (
    <ul className="space-y-3">
      {tests.map((t) => (
        <TestRow key={t.id} test={t} />
      ))}
    </ul>
  );
}

function TestRow({ test }: { test: DecoratedTest }) {
  const content = test.content;
  return (
    <li className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 px-5 py-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_12rem] lg:items-center">
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center rounded-pill bg-brand-black text-white font-heading font-bold text-xs px-3 py-1">
              Speaking · 3 parts
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
              {content?.part2.cue_card_topic ?? "Speaking test"}
            </h3>
            <p className="mt-1 font-body text-sm text-brand-grey-700 leading-relaxed">
              {content
                ? `Domain: ${content.topic_domain}`
                : "This test cannot start until its content is valid."}
            </p>
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm font-body text-brand-grey-700 sm:grid-cols-4">
            <Metric label="Length">~12 min</Metric>
            <Metric label="Format">Live voice</Metric>
            <Metric label="Level">{test.difficulty}</Metric>
            <Metric label="Domain">{content?.topic_domain ?? "Invalid"}</Metric>
          </dl>
        </div>
        <form action={startSpeakingAttempt}>
          <input type="hidden" name="testId" value={test.id} />
          <SubmitButton
            disabled={!content}
            pendingLabel="Starting…"
            className="w-full inline-flex items-center justify-center rounded-pill bg-brand-red px-5 py-3 font-heading font-bold text-white border border-brand-red transition-colors hover:bg-brand-red-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Start speaking test
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

function EmptyState() {
  return (
    <div className="rounded-lg bg-brand-white p-8 ring-1 ring-brand-grey-200">
      <p className="font-heading font-bold text-lg text-brand-black">
        No approved Speaking tests yet.
      </p>
      <p className="mt-2 font-body text-base text-brand-grey-700">
        Ask your admin to seed content, or come back once new tests have been
        approved.
      </p>
    </div>
  );
}

function NoResults() {
  return (
    <div className="rounded-lg bg-brand-white p-8 ring-1 ring-brand-grey-200">
      <p className="font-heading font-bold text-lg text-brand-black">
        No Speaking tests match those filters.
      </p>
      <p className="mt-2 font-body text-base text-brand-grey-700">
        Clear filters or choose a broader difficulty or domain.
      </p>
    </div>
  );
}
