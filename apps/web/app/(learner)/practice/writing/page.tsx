import type { Metadata } from "next";
import Link from "next/link";
import { firstNameFrom, withOrg } from "@elc/db";
import { requireOrgContext } from "@/lib/auth/context";
import { startAttempt } from "@/lib/attempts/actions";
import { SubmitButton } from "@/components/ui/submit-button";
import { RoleGreeting } from "@/components/role-greeting";
import {
  isWritingTaskType,
  taskBlurb,
  taskShortLabel,
  timeAllocationMinutes,
  wordTarget,
  type WritingTaskType,
} from "@/lib/writing/task";

export const metadata: Metadata = {
  title: "Writing practice",
};

export const dynamic = "force-dynamic";

type SearchParams = {
  difficulty?: string;
  task?: string;
};

type TaskFilter = "task1" | "task2";

function parseDifficulty(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 1 && value <= 5 ? value : null;
}

function parseTaskFilter(raw: unknown): TaskFilter | null {
  return raw === "task1" || raw === "task2" ? raw : null;
}

function matchesTaskFilter(type: WritingTaskType, filter: TaskFilter | null) {
  if (!filter) return true;
  return filter === "task2"
    ? type === "writing-task-2"
    : type !== "writing-task-2";
}

function previewOf(prompt: string, max = 190): string {
  const oneLine = prompt.replace(/\s+/g, " ").trim();
  if (oneLine.length <= max) return oneLine;
  return oneLine.slice(0, max - 1).trimEnd() + "…";
}

function difficultyDots(level: number): string {
  const filled = Math.max(1, Math.min(5, level));
  return "●".repeat(filled) + "○".repeat(5 - filled);
}

type DecoratedTest = {
  id: string;
  difficulty: number;
  question: { type: WritingTaskType; prompt: string };
};

export default async function WritingPickerPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const ctx = await requireOrgContext();
  const db = withOrg(ctx);
  const sp = await searchParams;
  const difficulty = parseDifficulty(sp.difficulty);
  const task = parseTaskFilter(sp.task);

  const me = await db.user.findUniqueOrThrow({
    where: { id: ctx.user_id },
    select: { ielts_track: true, name: true, email: true },
  });

  // Test is a global model — withOrg passes through unscoped, which is
  // correct: the content pool is shared across orgs.
  const tests = await db.test.findMany({
    where: {
      section: "Writing",
      status: "Approved",
      track: me.ielts_track,
    },
    select: {
      id: true,
      difficulty: true,
      questions: {
        select: { type: true, prompt: true },
        orderBy: { position: "asc" },
        take: 1,
      },
    },
    orderBy: [{ difficulty: "asc" }, { createdAt: "asc" }],
  });

  const decorated: DecoratedTest[] = [];
  for (const t of tests) {
    const q = t.questions[0];
    if (!q || !isWritingTaskType(q.type)) continue;
    decorated.push({
      id: t.id,
      difficulty: t.difficulty,
      question: { type: q.type, prompt: q.prompt },
    });
  }

  const filtered = decorated.filter((t) => {
    if (difficulty !== null && t.difficulty !== difficulty) return false;
    return matchesTaskFilter(t.question.type, task);
  });

  const trackLabel =
    me.ielts_track === "Academic" ? "Academic" : "General Training";
  const hasFilters = difficulty !== null || task !== null;

  return (
    <section className="px-6 py-12 md:py-16">
      <div className="mx-auto max-w-6xl">
        <RoleGreeting
          firstName={firstNameFrom(me)}
          tagline="Let's drill — Skills That Open Doorways."
        />
        <header className="mb-8">
          <p className="font-body text-sm uppercase tracking-widest text-brand-red">
            {trackLabel} · Writing
          </p>
          <h1 className="mt-2 font-display italic font-bold text-4xl md:text-5xl text-brand-black leading-tight">
            Pick a task. Get to writing.
          </h1>
          <p className="mt-4 font-body text-base text-brand-grey-700 max-w-2xl">
            Task 1 is ~150 words in about 20 minutes. Task 2 is ~250 words in
            about 40 minutes. Your timer is a soft guide — drill at your own
            pace.
          </p>
        </header>

        {decorated.length === 0 ? (
          <EmptyState trackLabel={trackLabel} />
        ) : (
          <>
            <WritingFilters
              difficulty={difficulty}
              task={task}
              hasFilters={hasFilters}
              total={decorated.length}
              filtered={filtered.length}
            />
            {filtered.length === 0 ? (
              <NoResults />
            ) : (
              <TaskList tests={filtered} />
            )}
          </>
        )}
      </div>
    </section>
  );
}

function WritingFilters({
  difficulty,
  task,
  hasFilters,
  total,
  filtered,
}: {
  difficulty: number | null;
  task: TaskFilter | null;
  hasFilters: boolean;
  total: number;
  filtered: number;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
      <p className="font-body text-sm text-brand-grey-700">
        Showing {filtered} of {total} tasks.
      </p>
      <form
        action="/practice/writing"
        method="get"
        className="grid w-full gap-3 sm:w-auto sm:grid-cols-[minmax(9rem,0.7fr)_minmax(9rem,0.7fr)_auto_auto] sm:items-end"
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
        <FilterSelect label="Task" name="task" value={task ?? ""}>
          <option value="">Any task</option>
          <option value="task1">Task 1</option>
          <option value="task2">Task 2</option>
        </FilterSelect>
        <button
          type="submit"
          className="inline-flex items-center justify-center rounded-pill bg-brand-red px-5 py-2.5 font-heading font-bold text-sm text-white border border-brand-red transition-colors hover:bg-brand-red-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2"
        >
          Filter
        </button>
        {hasFilters ? (
          <Link
            href="/practice/writing"
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

function TaskList({ tests }: { tests: DecoratedTest[] }) {
  return (
    <ul className="space-y-3">
      {tests.map((t) => (
        <TaskRow key={t.id} test={t} />
      ))}
    </ul>
  );
}

function TaskRow({ test }: { test: DecoratedTest }) {
  const type = test.question.type;
  return (
    <li className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 px-5 py-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_11rem] lg:items-center">
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center rounded-pill bg-brand-black text-white font-heading font-bold text-xs px-3 py-1">
              {taskShortLabel(type)}
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
              {previewOf(test.question.prompt, 150)}
            </h3>
            <p className="mt-1 font-body text-sm text-brand-grey-700 leading-relaxed">
              {taskBlurb(type)}
            </p>
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm font-body text-brand-grey-700 sm:grid-cols-4">
            <Metric label="Time">{timeAllocationMinutes(type)} min</Metric>
            <Metric label="Target">{wordTarget(type)} words</Metric>
            <Metric label="Level">{test.difficulty}</Metric>
            <Metric label="Task">
              {type === "writing-task-2" ? "Task 2" : "Task 1"}
            </Metric>
          </dl>
        </div>
        <form action={startAttempt}>
          <input type="hidden" name="testId" value={test.id} />
          <SubmitButton
            pendingLabel="Starting…"
            className="w-full inline-flex items-center justify-center rounded-pill bg-brand-red px-5 py-3 font-heading font-bold text-white border border-brand-red transition-colors hover:bg-brand-red-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            Start writing
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
        No approved Writing tasks yet for {trackLabel}.
      </p>
      <p className="mt-2 font-body text-base text-brand-grey-700">
        Ask your admin to seed content, or come back once new tasks have been
        approved.
      </p>
    </div>
  );
}

function NoResults() {
  return (
    <div className="rounded-lg bg-brand-white p-8 ring-1 ring-brand-grey-200">
      <p className="font-heading font-bold text-lg text-brand-black">
        No Writing tasks match those filters.
      </p>
      <p className="mt-2 font-body text-base text-brand-grey-700">
        Clear filters or choose a broader difficulty or task type.
      </p>
    </div>
  );
}
