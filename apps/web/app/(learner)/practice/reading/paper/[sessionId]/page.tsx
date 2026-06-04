import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requireOrgContext } from "@/lib/auth/context";
import {
  finalizePaperSession,
  readPaperSessionState,
  startReadingPaperPart,
} from "@/lib/reading/paper-session";
import { SubmitButton } from "@/components/ui/submit-button";

export const metadata: Metadata = {
  title: "Full Reading paper",
};

export const dynamic = "force-dynamic";

type Params = { sessionId: string };

export default async function ReadingPaperOrchestratorPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { sessionId } = await params;
  const ctx = await requireOrgContext();
  const state = await readPaperSessionState(ctx, sessionId);
  if (!state.ok) notFound();

  // Every part graded → finalize and route to the result. When this sitting
  // is a mock's Reading leg, bounce back to the mock orchestrator instead so
  // it can advance to Writing; the combined Reading band lands on the mock
  // aggregate, not a standalone paper result.
  if (state.allGraded) {
    await finalizePaperSession(ctx, sessionId);
    if (state.mockSessionId) {
      redirect(`/mock/${state.mockSessionId}`);
    }
    redirect(`/practice/reading/paper/${sessionId}/result`);
  }

  const trackLabel = state.track === "Academic" ? "Academic" : "General Training";
  const gradedCount = state.parts.filter((p) => p.state === "graded").length;

  return (
    <section className="px-6 py-12 md:py-16">
      <div className="mx-auto max-w-3xl space-y-8">
        <header>
          <p className="font-body text-sm uppercase tracking-widest text-brand-red">
            {trackLabel} · Full Reading paper
          </p>
          <h1 className="mt-2 font-display italic font-bold text-4xl md:text-5xl text-brand-black leading-tight">
            Three passages, one sitting.
          </h1>
          <p className="mt-4 font-body text-base text-brand-grey-700">
            Work through Part 1, 2, and 3 in order. Each part submits on its
            own, then you return here for the next. Your combined band appears
            once all three are done. {gradedCount} of {state.parts.length}{" "}
            complete.
          </p>
        </header>

        <ol className="space-y-3">
          {state.parts.map((p) => {
            const isCurrent = p.slot === state.currentSlot;
            return (
              <li
                key={p.slot}
                className={
                  "rounded-lg p-5 ring-1 " +
                  (isCurrent
                    ? "bg-brand-white ring-brand-red"
                    : "bg-brand-white ring-brand-grey-200")
                }
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-heading font-bold text-brand-black">
                      Part {p.slot}
                      {p.title ? (
                        <span className="ml-2 font-body font-normal text-sm text-brand-grey-600">
                          {p.title}
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-1 font-body text-xs uppercase tracking-wide text-brand-grey-500">
                      {p.state === "graded"
                        ? "Done"
                        : p.state === "in-progress"
                          ? "In progress"
                          : isCurrent
                            ? "Up next"
                            : "Locked"}
                    </p>
                  </div>
                  {isCurrent ? (
                    <form action={startReadingPaperPart}>
                      <input type="hidden" name="sessionId" value={sessionId} />
                      <input type="hidden" name="slot" value={p.slot} />
                      <SubmitButton
                        pendingLabel="Opening…"
                        className="inline-flex items-center rounded-pill bg-brand-red px-5 py-2.5 font-heading font-bold text-sm text-white border border-brand-red transition-colors hover:bg-brand-red-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2"
                      >
                        {p.state === "in-progress"
                          ? "Resume part"
                          : "Start part"}
                      </SubmitButton>
                    </form>
                  ) : p.state === "graded" ? (
                    <span
                      aria-hidden
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-brand-black text-white font-heading font-bold text-sm"
                    >
                      ✓
                    </span>
                  ) : (
                    <span className="font-body text-sm text-brand-grey-400">
                      —
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
