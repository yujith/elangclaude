import type { Metadata } from "next";
import { withOrg } from "@elc/db";
import { requireOrgContext } from "@/lib/auth/context";
import { parseSpeakingContent } from "@/lib/speaking/content";
import { startSpeakingAttempt } from "@/lib/speaking/actions";

export const metadata: Metadata = {
  title: "Speaking practice",
};

export const dynamic = "force-dynamic";

function difficultyDots(level: number): string {
  const filled = Math.max(1, Math.min(5, level));
  return "●".repeat(filled) + "○".repeat(5 - filled);
}

export default async function SpeakingPickerPage() {
  const ctx = await requireOrgContext();
  const db = withOrg(ctx);

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

  return (
    <section className="px-6 py-12 md:py-16">
      <div className="mx-auto max-w-5xl">
        <header className="mb-10">
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

        {tests.length === 0 ? (
          <div className="rounded-lg bg-brand-white p-8 ring-1 ring-brand-grey-200">
            <p className="font-heading font-bold text-lg text-brand-black">
              No approved Speaking tests yet.
            </p>
            <p className="mt-2 font-body text-base text-brand-grey-700">
              Ask your admin to seed content, or come back once new tests have
              been approved.
            </p>
          </div>
        ) : (
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {tests.map((t) => {
              const content = parseSpeakingContent(t.body_json);
              return (
                <li
                  key={t.id}
                  className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 p-6 flex flex-col gap-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="inline-flex items-center rounded-pill bg-brand-black text-white font-heading font-bold text-xs px-3 py-1">
                      Speaking · 3 parts
                    </span>
                    <span
                      className="font-body text-xs text-brand-grey-500"
                      aria-label={`Difficulty ${t.difficulty} of 5`}
                      title={`Difficulty ${t.difficulty} of 5`}
                    >
                      {difficultyDots(t.difficulty)}
                    </span>
                  </div>
                  {content ? (
                    <div className="space-y-1">
                      <p className="font-heading font-bold text-base text-brand-black leading-snug">
                        {content.part2.cue_card_topic}
                      </p>
                      <p className="font-body text-sm text-brand-grey-700">
                        Domain: {content.topic_domain}
                      </p>
                    </div>
                  ) : (
                    <p className="font-body text-sm text-brand-grey-500">
                      Speaking test
                    </p>
                  )}
                  <dl className="grid grid-cols-2 gap-3 text-sm font-body text-brand-grey-700">
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-brand-grey-500">
                        Length
                      </dt>
                      <dd className="font-heading font-bold text-brand-black">
                        ~12 min
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-brand-grey-500">
                        Format
                      </dt>
                      <dd className="font-heading font-bold text-brand-black">
                        Live voice
                      </dd>
                    </div>
                  </dl>
                  <form action={startSpeakingAttempt} className="mt-auto">
                    <input type="hidden" name="testId" value={t.id} />
                    <button
                      type="submit"
                      disabled={!content}
                      className="w-full inline-flex items-center justify-center gap-2 rounded-pill bg-brand-red px-5 py-3 font-heading font-bold text-white border border-brand-red transition-colors hover:bg-brand-red-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Start speaking test
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
