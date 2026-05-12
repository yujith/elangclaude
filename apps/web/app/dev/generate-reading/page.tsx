import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@elc/db/client";
import { parseReadingPassage, passageNeedsParagraphLabels } from "@elc/ai";
import {
  ForbiddenError,
  UnauthenticatedError,
  requireOrgContext,
} from "@/lib/auth/context";
import { generateReadingTestForm } from "@/lib/reading/generate-actions";

export const metadata: Metadata = {
  title: "Dev — generate Reading",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type SearchParams = {
  generated?: string;
  generate_error?: string;
  validation_issues?: string;
};

const ERROR_COPY: Record<string, string> = {
  quota:
    "The SuperAdmin's daily AI quota is used up. The pipeline refused before billing.",
  schema:
    "The model returned malformed JSON twice in a row. Re-roll, or revise the generation prompt.",
  validation:
    "The output parsed cleanly but failed the semantic validator. The specific failure codes are below; re-roll with a topic hint, or revise the prompt if you keep seeing the same code.",
  unknown:
    "Something else went wrong. Check the server console for the full stack.",
};

// Stable validator issue codes (see packages/ai/src/generation/validate.ts).
// Kept in lockstep with that file — if a new code lands, add the copy
// here so the dev page explains it.
const ISSUE_COPY: Record<string, string> = {
  "passage.too-short":
    "Passage word count fell below the per-track minimum (Academic 600, GT 400). The model under-wrote — try a chunkier topic hint.",
  "passage.too-long":
    "Passage word count exceeded the per-track maximum (Academic 950, GT 800). Often a runaway introduction; re-roll.",
  "completion.answer-not-in-passage":
    "A sentence-completion `accepted` string couldn't be located in the passage. The model invented an answer that isn't actually in the prose.",
  "short-answer.answer-not-in-passage":
    "A short-answer `accepted` string couldn't be located in the passage. Same failure mode as above.",
  "mcq.correct-not-grounded":
    "The MCQ correct option shares no substantive tokens (or numbers) with the passage. The model hallucinated the right answer.",
};

export default async function DevGenerateReadingPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  if (process.env.NODE_ENV === "production") notFound();

  const sp = await searchParams;

  // SuperAdmin only — the action requires it, but we also gate the page so
  // the form isn't dangled in front of a learner.
  try {
    const ctx = await requireOrgContext();
    if (ctx.role !== "SuperAdmin") {
      redirect("/dev/login?to=/dev/generate-reading");
    }
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      redirect("/dev/login?to=/dev/generate-reading");
    }
    if (err instanceof ForbiddenError) {
      redirect("/dev/login?to=/dev/generate-reading");
    }
    throw err;
  }

  const generated = sp.generated
    ? await prisma.test.findUnique({
        where: { id: sp.generated },
        select: {
          id: true,
          track: true,
          difficulty: true,
          status: true,
          body_json: true,
          createdAt: true,
          questions: {
            select: { id: true, type: true, position: true, prompt: true },
            orderBy: { position: "asc" },
          },
        },
      })
    : null;

  const passage =
    generated && generated.body_json
      ? parseReadingPassage(generated.body_json)
      : null;
  const showParagraphLabels = generated
    ? passageNeedsParagraphLabels(generated.questions.map((q) => q.type))
    : false;

  return (
    <main className="min-h-screen bg-brand-grey-50 px-6 py-16">
      <div className="mx-auto max-w-3xl space-y-8">
        <header>
          <p className="font-body text-sm uppercase tracking-widest text-brand-red">
            Dev only — Phase 5
          </p>
          <h1 className="mt-2 font-heading font-bold text-3xl text-brand-black">
            Generate a Reading passage
          </h1>
          <p className="mt-3 font-body text-base text-brand-grey-700">
            Calls the <code>reading-generate</code> purpose through the AI
            gateway. The new <code>Test</code> row lands as{" "}
            <code>PendingReview</code> — learners won&apos;t see it until a
            SuperAdmin promotes it (Phase 6). Each call bills the
            SuperAdmin&apos;s daily quota.
          </p>
        </header>

        {sp.generate_error ? (
          <div className="rounded-lg bg-brand-red-soft ring-1 ring-brand-red/40 p-5 space-y-3">
            <div>
              <p className="font-heading font-bold text-sm text-brand-black">
                Generation failed: {sp.generate_error}
              </p>
              <p className="mt-1 font-body text-sm text-brand-grey-900">
                {ERROR_COPY[sp.generate_error] ?? "Unknown failure mode."}
              </p>
            </div>
            {sp.generate_error === "validation" && sp.validation_issues ? (
              <ul className="space-y-2 pl-2">
                {sp.validation_issues.split(",").map((code) => (
                  <li
                    key={code}
                    className="font-body text-sm text-brand-grey-900"
                  >
                    <code className="font-heading font-bold text-brand-red">
                      {code}
                    </code>
                    <span className="ml-2">
                      {ISSUE_COPY[code] ??
                        "(no description — check the server console.)"}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="font-body text-xs text-brand-grey-600">
              Full issue array is logged to the server console (the terminal
              running <code>pnpm dev</code>).
            </p>
          </div>
        ) : null}

        <section className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 p-6">
          <form action={generateReadingTestForm} className="space-y-5">
            <input type="hidden" name="returnTo" value="/dev/generate-reading" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="track"
                  className="block font-heading font-bold text-sm text-brand-black mb-2"
                >
                  Track
                </label>
                <select
                  id="track"
                  name="track"
                  defaultValue="Academic"
                  className="w-full rounded-md ring-1 ring-brand-grey-300 bg-white px-3 py-2 font-body text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red"
                >
                  <option value="Academic">Academic</option>
                  <option value="GeneralTraining">General Training</option>
                </select>
              </div>
              <div>
                <label
                  htmlFor="difficulty"
                  className="block font-heading font-bold text-sm text-brand-black mb-2"
                >
                  Difficulty (1–5)
                </label>
                <input
                  id="difficulty"
                  name="difficulty"
                  type="number"
                  min={1}
                  max={5}
                  defaultValue={5}
                  className="w-full rounded-md ring-1 ring-brand-grey-300 bg-white px-3 py-2 font-body text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red"
                />
              </div>
            </div>
            <div>
              <label
                htmlFor="topicHint"
                className="block font-heading font-bold text-sm text-brand-black mb-2"
              >
                Topic hint (optional)
              </label>
              <input
                id="topicHint"
                name="topicHint"
                type="text"
                placeholder="e.g. the history of refrigeration"
                className="w-full rounded-md ring-1 ring-brand-grey-300 bg-white px-3 py-2 font-body text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red"
              />
              <p className="mt-1 font-body text-xs text-brand-grey-500">
                Helps when re-rolling — the model avoids repeating itself.
              </p>
            </div>
            <button
              type="submit"
              className="inline-flex items-center rounded-pill bg-brand-red px-6 py-3 font-heading font-bold text-white border border-brand-red transition-colors hover:bg-brand-red-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2"
            >
              Generate passage
            </button>
            <p className="font-body text-xs text-brand-grey-500">
              Submits to <code>generateReadingTestForm</code>. A successful run
              redirects back here with the new test id; a failed run redirects
              with <code>?generate_error=…</code>.
            </p>
          </form>
        </section>

        {generated ? (
          <section className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 p-6 space-y-4">
            <header>
              <p className="font-body text-xs uppercase tracking-widest text-brand-red">
                Generated
              </p>
              <h2 className="mt-1 font-heading font-bold text-xl text-brand-black">
                {passage?.title ?? "(untitled passage)"}
              </h2>
              <p className="mt-1 font-body text-sm text-brand-grey-700">
                {generated.track} · difficulty {generated.difficulty} ·{" "}
                status <code>{generated.status}</code> · {generated.questions.length} questions
              </p>
              <p className="mt-1 font-body text-xs text-brand-grey-500">
                Test id: <code>{generated.id}</code>
              </p>
            </header>

            {passage ? (
              <details className="rounded-md ring-1 ring-brand-grey-200 p-4 bg-brand-grey-50">
                <summary className="cursor-pointer font-heading font-bold text-sm text-brand-black select-none">
                  Show passage
                </summary>
                <div className="mt-3 space-y-3">
                  {passage.paragraphs.map((p) => (
                    <p
                      key={p.label}
                      className="font-body text-sm text-brand-grey-900 leading-relaxed"
                    >
                      {showParagraphLabels ? (
                        <span className="font-heading font-bold text-brand-red mr-2">
                          {p.label}
                        </span>
                      ) : null}
                      {p.text}
                    </p>
                  ))}
                </div>
              </details>
            ) : null}

            <details className="rounded-md ring-1 ring-brand-grey-200 p-4 bg-brand-grey-50">
              <summary className="cursor-pointer font-heading font-bold text-sm text-brand-black select-none">
                Show {generated.questions.length} questions
              </summary>
              <ol className="mt-3 space-y-2">
                {generated.questions.map((q) => (
                  <li
                    key={q.id}
                    className="font-body text-sm text-brand-grey-900"
                  >
                    <span className="font-heading font-bold text-brand-red mr-2">
                      {q.position + 1}.
                    </span>
                    <span className="font-body text-xs text-brand-grey-500 mr-2">
                      [{q.type}]
                    </span>
                    {q.prompt}
                  </li>
                ))}
              </ol>
            </details>

            <p className="font-body text-xs text-brand-grey-500">
              This test will <strong>not</strong> appear in{" "}
              <Link
                href="/practice/reading"
                className="underline hover:text-brand-red"
              >
                /practice/reading
              </Link>{" "}
              until a SuperAdmin flips its status to <code>Approved</code>{" "}
              (Phase 6 moderation console).
            </p>
          </section>
        ) : null}
      </div>
    </main>
  );
}
