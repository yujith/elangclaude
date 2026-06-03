import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { withOrg } from "@elc/db";
import type { Section } from "@elc/db";
import {
  parseListeningGrade,
  parseReadingGrade,
  speakingGradeSchema,
  writingGradeSchema,
} from "@elc/ai";
import { requireOrgContext } from "@/lib/auth/context";
import { readSkippedSections, submitMockSession } from "@/lib/mock/actions";
import { SubmitButton } from "@/components/ui/submit-button";
import { MOCK_SECTION_ORDER } from "@/lib/mock/constants";

export const metadata: Metadata = {
  title: "Full Mock — result",
};

export const dynamic = "force-dynamic";

type Params = { mockId: string };

type SectionBand = {
  section: Section;
  state: "graded" | "missing" | "skipped";
  band: number | null;
  attemptId: string | null;
};

export default async function MockResultPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { mockId } = await params;
  const ctx = await requireOrgContext();
  const db = withOrg(ctx);

  const session = await db.mockSession.findUnique({
    where: { id: mockId },
    select: {
      id: true,
      user_id: true,
      track: true,
      status: true,
      started_at: true,
      submitted_at: true,
      attempts: {
        select: {
          id: true,
          section: true,
          grade: {
            select: { band_overall: true, criteria_scores_json: true },
          },
        },
      },
    },
  });
  if (!session || session.user_id !== ctx.user_id) notFound();

  const skipped = await readSkippedSections(ctx, mockId);

  const bands: SectionBand[] = MOCK_SECTION_ORDER.map((section) => {
    const attempt = session.attempts.find((a) => a.section === section);
    if (skipped.has(section) && !attempt) {
      return { section, state: "skipped", band: null, attemptId: null };
    }
    if (!attempt || !attempt.grade) {
      return {
        section,
        state: "missing",
        band: null,
        attemptId: attempt?.id ?? null,
      };
    }
    const band = readSectionBand(section, attempt.grade.criteria_scores_json);
    return {
      section,
      state: "graded",
      band,
      attemptId: attempt.id,
    };
  });

  const overall = computeOverall(bands);
  const trackLabel =
    session.track === "Academic" ? "Academic" : "General Training";

  return (
    <section className="bg-brand-grey-50 px-6 py-12 md:py-16">
      <div className="mx-auto max-w-4xl space-y-8">
        <header>
          <p className="font-body text-sm uppercase tracking-widest text-brand-red">
            Full Mock · {trackLabel}
          </p>
          <h1 className="mt-2 font-display italic font-bold text-4xl md:text-5xl text-brand-black leading-tight">
            Here&apos;s the whole sitting.
          </h1>
          <p className="mt-3 font-body text-sm text-brand-grey-700">
            {session.status === "Submitted"
              ? `Submitted ${session.submitted_at?.toISOString().slice(0, 10) ?? "—"}`
              : `Status: ${session.status}`}
          </p>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Stat
            label="Overall band"
            big={overall === null ? "—" : overall.toFixed(1)}
            sub={
              overall === null
                ? "No section bands yet"
                : "Mean of the section bands, rounded to the nearest half band."
            }
          />
          <Stat
            label="Sections completed"
            big={`${bands.filter((b) => b.state === "graded").length} / ${bands.length}`}
            sub={
              bands.some((b) => b.state === "skipped")
                ? "Skipped sections excluded from the overall band."
                : "All four sections counted."
            }
          />
        </div>

        <section className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 overflow-hidden">
          <ol className="divide-y divide-brand-grey-200">
            {bands.map((b) => (
              <li
                key={b.section}
                className="px-5 py-4 flex items-center justify-between gap-4"
              >
                <div>
                  <p className="font-heading font-bold text-base text-brand-black">
                    {b.section}
                  </p>
                  <p className="font-body text-xs text-brand-grey-600">
                    {b.state === "graded"
                      ? "Graded."
                      : b.state === "skipped"
                        ? "Skipped during the mock."
                        : "Not graded yet."}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <p className="font-display italic font-bold text-2xl text-brand-black">
                    {b.band !== null ? b.band.toFixed(1) : "—"}
                  </p>
                  {b.attemptId ? (
                    <Link
                      href={`/results/${b.attemptId}`}
                      className="inline-flex items-center rounded-pill bg-brand-black text-white font-heading font-bold text-xs px-3 py-1.5 hover:bg-brand-grey-900"
                    >
                      Section detail
                    </Link>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </section>

        {session.status === "InProgress" ? (
          <form action={submitMockSession}>
            <input type="hidden" name="mockId" value={session.id} />
            <SubmitButton
              pendingLabel="Submitting…"
              className="inline-flex items-center gap-2 rounded-pill bg-brand-red px-6 py-3 font-heading font-bold text-white border border-brand-red transition-colors hover:bg-brand-red-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              Lock in this mock
            </SubmitButton>
          </form>
        ) : null}

        <div className="flex flex-wrap gap-3">
          <Link
            href="/mock"
            className="inline-flex items-center gap-2 rounded-pill bg-brand-black px-5 py-2.5 font-heading font-bold text-white transition-colors hover:bg-brand-grey-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2"
          >
            Back to mock picker
          </Link>
          <Link
            href="/practice/listening"
            className="inline-flex items-center gap-2 rounded-pill bg-brand-white ring-1 ring-brand-grey-200 px-5 py-2.5 font-heading font-bold text-brand-black hover:bg-brand-grey-50"
          >
            Drill Listening
          </Link>
        </div>
      </div>
    </section>
  );
}

function Stat({
  label,
  big,
  sub,
}: {
  label: string;
  big: string;
  sub: string;
}) {
  return (
    <div className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 p-5">
      <p className="font-body text-xs uppercase tracking-wide text-brand-grey-500">
        {label}
      </p>
      <p className="mt-1 font-display italic font-bold text-3xl text-brand-black leading-none">
        {big}
      </p>
      <p className="mt-2 font-body text-xs text-brand-grey-600">{sub}</p>
    </div>
  );
}

function readSectionBand(section: Section, payload: unknown): number | null {
  if (section === "Listening") {
    const g = parseListeningGrade(payload);
    return g ? g.band_overall : null;
  }
  if (section === "Reading") {
    const g = parseReadingGrade(payload);
    return g ? g.band_overall : null;
  }
  if (section === "Writing") {
    const r = writingGradeSchema.safeParse(payload);
    return r.success ? r.data.band_overall : null;
  }
  if (section === "Speaking") {
    const r = speakingGradeSchema.safeParse(payload);
    return r.success ? r.data.band_overall : null;
  }
  return null;
}

// IELTS aggregate band: mean of section bands rounded to the nearest
// half band. Skipped + missing sections are excluded. Returns null if
// no sections have a band.
function computeOverall(bands: SectionBand[]): number | null {
  const observed = bands
    .filter((b) => b.state === "graded" && b.band !== null)
    .map((b) => b.band as number);
  if (observed.length === 0) return null;
  const mean = observed.reduce((s, n) => s + n, 0) / observed.length;
  return Math.round(mean * 2) / 2;
}
