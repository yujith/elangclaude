import type { Metadata } from "next";
import { withOrg } from "@elc/db";
import { requireOrgContext } from "@/lib/auth/context";
import { startAttempt } from "@/lib/attempts/actions";
import {
  isWritingTaskType,
  taskBlurb,
  taskShortLabel,
  timeAllocationMinutes,
  wordTarget,
} from "@/lib/writing/task";

export const metadata: Metadata = {
  title: "Writing practice",
};

export const dynamic = "force-dynamic";

function previewOf(prompt: string, max = 180): string {
  const oneLine = prompt.replace(/\s+/g, " ").trim();
  if (oneLine.length <= max) return oneLine;
  return oneLine.slice(0, max - 1).trimEnd() + "…";
}

function difficultyDots(level: number): string {
  const filled = Math.max(1, Math.min(5, level));
  return "●".repeat(filled) + "○".repeat(5 - filled);
}

export default async function WritingPickerPage() {
  const ctx = await requireOrgContext();
  const db = withOrg(ctx);

  const me = await db.user.findUniqueOrThrow({
    where: { id: ctx.user_id },
    select: { ielts_track: true },
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

  const trackLabel =
    me.ielts_track === "Academic" ? "Academic" : "General Training";

  return (
    <section className="px-6 py-12 md:py-16">
      <div className="mx-auto max-w-5xl">
        <header className="mb-10">
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

        {tests.length === 0 ? (
          <div className="rounded-lg bg-brand-white p-8 ring-1 ring-brand-grey-200">
            <p className="font-heading font-bold text-lg text-brand-black">
              No approved Writing tasks yet for {trackLabel}.
            </p>
            <p className="mt-2 font-body text-base text-brand-grey-700">
              Ask your admin to seed content, or come back once new tasks have
              been approved.
            </p>
          </div>
        ) : (
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {tests.map((t) => {
              const q = t.questions[0];
              const type = q && isWritingTaskType(q.type) ? q.type : null;
              if (!type || !q) return null;
              return (
                <li
                  key={t.id}
                  className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 p-6 flex flex-col gap-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="inline-flex items-center rounded-pill bg-brand-black text-white font-heading font-bold text-xs px-3 py-1">
                      {taskShortLabel(type)}
                    </span>
                    <span
                      className="font-body text-xs text-brand-grey-500"
                      aria-label={`Difficulty ${t.difficulty} of 5`}
                      title={`Difficulty ${t.difficulty} of 5`}
                    >
                      {difficultyDots(t.difficulty)}
                    </span>
                  </div>
                  <p className="font-body text-base text-brand-grey-900 leading-relaxed">
                    {previewOf(q.prompt)}
                  </p>
                  <dl className="grid grid-cols-2 gap-3 text-sm font-body text-brand-grey-700">
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-brand-grey-500">
                        Time
                      </dt>
                      <dd className="font-heading font-bold text-brand-black">
                        {timeAllocationMinutes(type)} min
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-brand-grey-500">
                        Target
                      </dt>
                      <dd className="font-heading font-bold text-brand-black">
                        {wordTarget(type)} words
                      </dd>
                    </div>
                  </dl>
                  <form action={startAttempt} className="mt-auto">
                    <input type="hidden" name="testId" value={t.id} />
                    <button
                      type="submit"
                      className="w-full inline-flex items-center justify-center gap-2 rounded-pill bg-brand-red px-5 py-3 font-heading font-bold text-white border border-brand-red transition-colors hover:bg-brand-red-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2"
                    >
                      Start writing
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
