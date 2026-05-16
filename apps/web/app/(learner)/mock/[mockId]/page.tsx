import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Section } from "@elc/db";
import { requireOrgContext } from "@/lib/auth/context";
import {
  MOCK_SECTION_ORDER,
  ensureMockSectionAttempt,
  readMockState,
  readSkippedSections,
  skipMockSection,
  abandonMockSession,
} from "@/lib/mock/actions";

export const metadata: Metadata = {
  title: "Full Mock — in progress",
};

export const dynamic = "force-dynamic";

type Params = { mockId: string };

const RUNNER_PATH: Record<Section, (attemptId: string) => string> = {
  Listening: (id) => `/practice/listening/${id}`,
  Reading: (id) => `/practice/reading/${id}`,
  Writing: (id) => `/practice/writing/${id}`,
  Speaking: (id) => `/practice/speaking/${id}`,
};

const SECTION_COPY: Record<
  Section,
  { time: string; hint: string }
> = {
  Listening: {
    time: "~30 min",
    hint: "Single-play exam mode. The audio for each part plays once.",
  },
  Reading: {
    time: "60 min",
    hint: "One passage per attempt at this scale — start when you're ready.",
  },
  Writing: {
    time: "60 min",
    hint: "Task 1 + Task 2. The AI examiner grades both on the IELTS rubric.",
  },
  Speaking: {
    time: "~14 min",
    hint: "Voice conversation with the AI examiner. Needs your microphone.",
  },
};

export default async function MockOrchestratorPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { mockId } = await params;
  const ctx = await requireOrgContext();
  const state = await readMockState(ctx, mockId);
  if (!state) notFound();

  // Already finished — go to the aggregate.
  if (state.status === "Submitted") {
    redirect(`/mock/${mockId}/result`);
  }

  const skipped = await readSkippedSections(ctx, mockId);
  // Augment state.sections with the explicit-skip view: if the section
  // had no Attempt AND the learner skipped it, mark it as "skipped".
  // The current-section search re-runs honouring skips.
  const decoratedSections = state.sections.map((s) => {
    if (s.state === "not-started" && skipped.has(s.section)) {
      return { ...s, state: "skipped" as const };
    }
    return s;
  });
  const currentSection = decoratedSections.find(
    (s) => s.state !== "graded" && s.state !== "skipped",
  )?.section;

  // All sections finished (graded or skipped). Render an aggregate-prep
  // panel inviting the learner to submit. We do NOT auto-submit — a
  // learner might be paused between sections and want to revisit one
  // (Speaking, in particular, sometimes lands as not-started after a
  // mic-permission fail; auto-submit would hide that recoverable case).
  if (!currentSection) {
    return (
      <CompletionPanel
        mockId={state.mockId}
        sections={decoratedSections}
        track={state.track}
      />
    );
  }

  // Ensure we have an Attempt for the current section. If no approved
  // Test exists, we render a skip affordance — the orchestrator does
  // not block the whole mock on a missing section.
  const ensured = await ensureMockSectionAttempt(ctx, mockId, currentSection);
  if (ensured.ok) {
    redirect(RUNNER_PATH[currentSection](ensured.attemptId));
  }

  return (
    <NoTestPanel
      mockId={state.mockId}
      section={currentSection}
      track={state.track}
      sections={decoratedSections}
    />
  );
}

function CompletionPanel({
  mockId,
  sections,
  track,
}: {
  mockId: string;
  sections: { section: Section; state: string; attemptId: string | null }[];
  track: "Academic" | "GeneralTraining";
}) {
  return (
    <section className="px-6 py-12 md:py-16">
      <div className="mx-auto max-w-3xl space-y-8">
        <header>
          <p className="font-body text-sm uppercase tracking-widest text-brand-red">
            {track === "Academic" ? "Academic" : "General Training"} mock
          </p>
          <h1 className="mt-2 font-display italic font-bold text-3xl md:text-4xl text-brand-black leading-tight">
            Every section is in. Ready to lock it in?
          </h1>
          <p className="mt-3 font-body text-base text-brand-grey-700">
            Submitting takes you to the aggregate result page. You can
            still go back to{" "}
            <Link
              href="/mock"
              className="font-heading font-bold text-brand-red hover:underline"
            >
              the mock picker
            </Link>{" "}
            if you want to revisit one of the section attempts first.
          </p>
        </header>

        <SectionBoard sections={sections} />

        <div className="rounded-lg bg-brand-black text-white p-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="font-heading font-bold text-lg">
              Submit the full mock.
            </p>
            <p className="font-body text-sm text-white/70">
              Locks all four section bands into one aggregate band.
            </p>
          </div>
          <form action="/mock/submit" method="get">
            <Link
              href={`/mock/${mockId}/result`}
              className="inline-flex items-center gap-2 rounded-pill bg-brand-red px-6 py-3 font-heading font-bold text-white border border-brand-red transition-colors hover:bg-brand-red-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 focus-visible:ring-offset-brand-black"
            >
              See the aggregate
            </Link>
          </form>
        </div>
      </div>
    </section>
  );
}

function NoTestPanel({
  mockId,
  section,
  track,
  sections,
}: {
  mockId: string;
  section: Section;
  track: "Academic" | "GeneralTraining";
  sections: { section: Section; state: string; attemptId: string | null }[];
}) {
  return (
    <section className="px-6 py-12 md:py-16">
      <div className="mx-auto max-w-3xl space-y-8">
        <header>
          <p className="font-body text-sm uppercase tracking-widest text-brand-red">
            {track === "Academic" ? "Academic" : "General Training"} mock
          </p>
          <h1 className="mt-2 font-display italic font-bold text-3xl md:text-4xl text-brand-black leading-tight">
            No approved {section} test available.
          </h1>
          <p className="mt-3 font-body text-base text-brand-grey-700">
            We couldn&apos;t find an approved {section} section to slot in
            here. Skip this section to keep the mock moving — the aggregate
            band will average over the sections you did complete.
          </p>
        </header>

        <SectionBoard sections={sections} />

        <div className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 p-6 flex flex-wrap items-center gap-3">
          <form action={skipMockSection}>
            <input type="hidden" name="mockId" value={mockId} />
            <input type="hidden" name="section" value={section} />
            <button
              type="submit"
              className="inline-flex items-center rounded-pill bg-brand-red px-5 py-2.5 font-heading font-bold text-white border border-brand-red transition-colors hover:bg-brand-red-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2"
            >
              Skip {section} and continue
            </button>
          </form>
          <form action={abandonMockSession}>
            <input type="hidden" name="mockId" value={mockId} />
            <button
              type="submit"
              className="inline-flex items-center rounded-pill bg-brand-grey-100 px-5 py-2.5 font-heading font-bold text-brand-grey-800 hover:bg-brand-grey-200"
            >
              Abandon mock
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}

function SectionBoard({
  sections,
}: {
  sections: { section: Section; state: string; attemptId: string | null }[];
}) {
  return (
    <ol className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 divide-y divide-brand-grey-200">
      {MOCK_SECTION_ORDER.map((s) => {
        const slot = sections.find((x) => x.section === s);
        const state = slot?.state ?? "not-started";
        const copy = SECTION_COPY[s];
        return (
          <li
            key={s}
            className="px-5 py-4 flex items-start justify-between gap-4"
          >
            <div>
              <p className="font-heading font-bold text-sm text-brand-black">
                {s}{" "}
                <span className="font-body font-normal text-brand-grey-500 text-xs">
                  · {copy.time}
                </span>
              </p>
              <p className="font-body text-xs text-brand-grey-600">
                {copy.hint}
              </p>
            </div>
            <StateBadge state={state} />
          </li>
        );
      })}
    </ol>
  );
}

function StateBadge({ state }: { state: string }) {
  const styles =
    state === "graded"
      ? "bg-brand-black text-white"
      : state === "in-progress"
        ? "bg-brand-red text-white"
        : state === "skipped"
          ? "bg-brand-grey-100 text-brand-grey-700"
          : "bg-brand-grey-50 text-brand-grey-700 ring-1 ring-brand-grey-200";
  const label =
    state === "graded"
      ? "Done"
      : state === "in-progress"
        ? "In progress"
        : state === "skipped"
          ? "Skipped"
          : "Up next";
  return (
    <span
      className={`inline-flex items-center rounded-pill font-heading font-bold text-xs px-3 py-1 ${styles}`}
    >
      {label}
    </span>
  );
}
