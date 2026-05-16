import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@elc/db/client";
import { parseListeningContent } from "@elc/ai";
import {
  ForbiddenError,
  UnauthenticatedError,
  requireOrgContext,
} from "@/lib/auth/context";
import { generateListeningTestForm } from "@/lib/listening/generate-actions";

export const metadata: Metadata = {
  title: "Dev — generate Listening",
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
    "The output parsed cleanly but failed the semantic validator. The specific failure codes are below.",
  unknown:
    "Something else went wrong. Check the server console for the full stack.",
};

// Stable validator issue codes (see packages/ai/src/generation/listening-
// validate.ts). Keep in lockstep — if a new code lands, add the copy here.
const ISSUE_COPY: Record<string, string> = {
  "positions.duplicate-on-question":
    "Two Question rows share the same position. The model double-numbered a question.",
  "positions.in-multiple-parts":
    "A position appears in more than one part's question_positions array.",
  "positions.unreferenced-by-question":
    "A part declares a position that no Question row backs.",
  "positions.question-not-in-any-part":
    "A Question position doesn't appear in any part's question_positions.",
  "preview.position-outside-part":
    "A questions-preview segment points at a position that doesn't belong to its enclosing part.",
  "speakers.duplicate-id":
    "A speaker id is reused within the same part.",
  "speakers.unknown-speech-reference":
    "A speech segment references a speaker_id that isn't in its part's speakers array.",
  "blocks.duplicate-id":
    "Two completion blocks share the same id.",
  "slots.duplicate-id":
    "A slot id appears in more than one completion block across the section.",
  "completion-blank.block-not-found":
    "A completion-blank question references a block_id that doesn't exist.",
  "completion-blank.slot-not-found":
    "A completion-blank question references a slot_id that doesn't exist in the named block.",
  "answer.not-in-transcript":
    "An accepted answer string for a completion / sentence / short-answer question wasn't found in its part's transcript.",
  "mcq.correct-not-grounded":
    "The MCQ correct option shares no substantive tokens with the part transcript. The model hallucinated.",
};

export default async function DevGenerateListeningPage({
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
      redirect("/dev/login?to=/dev/generate-listening");
    }
  } catch (err) {
    if (err instanceof UnauthenticatedError || err instanceof ForbiddenError) {
      redirect("/dev/login?to=/dev/generate-listening");
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
            select: { id: true, type: true, position: true, prompt: true, points: true },
            orderBy: { position: "asc" },
          },
        },
      })
    : null;

  const content =
    generated && generated.body_json
      ? parseListeningContent(generated.body_json)
      : null;

  return (
    <main className="min-h-screen bg-brand-grey-50 px-6 py-16">
      <div className="mx-auto max-w-3xl space-y-8">
        <header>
          <p className="font-body text-sm uppercase tracking-widest text-brand-red">
            Dev only — Phase 3 + 4
          </p>
          <h1 className="mt-2 font-heading font-bold text-3xl text-brand-black">
            Generate a Listening section
          </h1>
          <p className="mt-3 font-body text-base text-brand-grey-700">
            Calls the <code>listening-generate</code> purpose through the AI
            gateway. The new <code>Test</code> row lands as{" "}
            <code>PendingReview</code> with no audio yet — TTS synth runs at
            SuperAdmin-approval time (Phase 5). Each call bills the
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
          </div>
        ) : null}

        <section className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 p-6">
          <form action={generateListeningTestForm} className="space-y-5">
            <input
              type="hidden"
              name="returnTo"
              value="/dev/generate-listening"
            />
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
                  defaultValue={3}
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
                placeholder="e.g. community gardens and urban planning"
                className="w-full rounded-md ring-1 ring-brand-grey-300 bg-white px-3 py-2 font-body text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red"
              />
            </div>
            <button
              type="submit"
              className="inline-flex items-center rounded-pill bg-brand-red px-6 py-3 font-heading font-bold text-white border border-brand-red transition-colors hover:bg-brand-red-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2"
            >
              Generate section
            </button>
          </form>
        </section>

        {generated && content ? (
          <section className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 p-6 space-y-4">
            <header>
              <p className="font-body text-xs uppercase tracking-widest text-brand-red">
                Generated
              </p>
              <h2 className="mt-1 font-heading font-bold text-xl text-brand-black">
                Listening section · {generated.track}
              </h2>
              <p className="mt-1 font-body text-sm text-brand-grey-700">
                difficulty {generated.difficulty} · status{" "}
                <code>{generated.status}</code> · {generated.questions.length}{" "}
                questions across {content.parts.length} parts
              </p>
              <p className="mt-1 font-body text-xs text-brand-grey-500">
                Test id: <code>{generated.id}</code>
              </p>
            </header>

            {content.parts.map((part) => {
              const partQuestions = generated.questions.filter((q) =>
                part.question_positions.includes(q.position),
              );
              return (
                <details
                  key={part.part}
                  className="rounded-md ring-1 ring-brand-grey-200 p-4 bg-brand-grey-50"
                >
                  <summary className="cursor-pointer font-heading font-bold text-sm text-brand-black select-none">
                    Part {part.part} — {part.title}{" "}
                    <span className="font-body font-normal text-brand-grey-600">
                      ({part.context}, {partQuestions.length} questions,{" "}
                      {part.speakers.length} speakers)
                    </span>
                  </summary>
                  <div className="mt-3 space-y-3">
                    <div className="font-body text-xs text-brand-grey-600">
                      Speakers:{" "}
                      {part.speakers
                        .map((s) => `${s.name} (${s.accent})`)
                        .join(", ")}
                    </div>
                    <div className="space-y-2">
                      {part.transcript.map((seg, i) => (
                        <p
                          key={i}
                          className="font-body text-sm text-brand-grey-900 leading-relaxed"
                        >
                          {seg.kind === "narration" ? (
                            <span>
                              <span className="font-heading font-bold text-brand-grey-600 mr-2">
                                [Narrator]
                              </span>
                              {seg.text}
                            </span>
                          ) : seg.kind === "speech" ? (
                            <span>
                              <span className="font-heading font-bold text-brand-red mr-2">
                                [{seg.speaker_id}]
                              </span>
                              {seg.text}
                            </span>
                          ) : seg.kind === "reading-pause" ? (
                            <span className="italic text-brand-grey-500">
                              [pause {seg.seconds}s
                              {seg.instruction ? `: ${seg.instruction}` : ""}]
                            </span>
                          ) : (
                            <span className="italic text-brand-grey-500">
                              [preview Qs {seg.question_positions.join(", ")} —{" "}
                              {seg.seconds}s]
                            </span>
                          )}
                        </p>
                      ))}
                    </div>
                    <ol className="space-y-1 pt-3 border-t border-brand-grey-200">
                      {partQuestions.map((q) => (
                        <li
                          key={q.id}
                          className="font-body text-sm text-brand-grey-900"
                        >
                          <span className="font-heading font-bold text-brand-red mr-2">
                            {q.position + 1}.
                          </span>
                          <span className="font-body text-xs text-brand-grey-500 mr-2">
                            [{q.type} · {q.points}pt]
                          </span>
                          {q.prompt}
                        </li>
                      ))}
                    </ol>
                  </div>
                </details>
              );
            })}

            <p className="font-body text-xs text-brand-grey-500">
              This test will <strong>not</strong> appear in{" "}
              <Link
                href="/practice/listening"
                className="underline hover:text-brand-red"
              >
                /practice/listening
              </Link>{" "}
              until a SuperAdmin approves it AND its TTS clips are synthesised
              (Phase 5).
            </p>
          </section>
        ) : null}
      </div>
    </main>
  );
}
