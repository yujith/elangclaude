import type { Metadata } from "next";
import Link from "next/link";
import { withOrg } from "@elc/db";
import { requireOrgContext } from "@/lib/auth/context";
import { startMockSession } from "@/lib/mock/actions";

export const metadata: Metadata = {
  title: "Full Mock Test",
};

export const dynamic = "force-dynamic";

export default async function MockPickerPage() {
  const ctx = await requireOrgContext();
  const db = withOrg(ctx);

  const me = await db.user.findUniqueOrThrow({
    where: { id: ctx.user_id },
    select: { ielts_track: true },
  });
  const recent = await db.mockSession.findMany({
    where: { user_id: ctx.user_id },
    orderBy: { started_at: "desc" },
    take: 5,
    select: {
      id: true,
      track: true,
      status: true,
      started_at: true,
      submitted_at: true,
    },
  });

  const trackLabel =
    me.ielts_track === "Academic" ? "Academic" : "General Training";

  return (
    <section className="px-6 py-12 md:py-16">
      <div className="mx-auto max-w-4xl space-y-10">
        <header>
          <p className="font-body text-sm uppercase tracking-widest text-brand-red">
            Full Mock Test
          </p>
          <h1 className="mt-2 font-display italic font-bold text-4xl md:text-5xl text-brand-black leading-tight">
            One sitting. All four sections.
          </h1>
          <p className="mt-4 font-body text-base text-brand-grey-700 max-w-2xl">
            Listening → Reading → Writing → Speaking, in order, with the
            real-exam timings. Listening locks to single-play exam mode;
            you cannot revisit a finished section. Plan for about 2 hours
            45 minutes, plus a few minutes of Speaking warm-up.
          </p>
        </header>

        <section className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 p-6 space-y-5">
          <h2 className="font-heading font-bold text-xl text-brand-black">
            Start a new mock
          </h2>
          <p className="font-body text-sm text-brand-grey-700">
            Your track is <strong>{trackLabel}</strong>. The picker reuses
            approved content from your section pool — same passages, same
            questions, played as one timed sitting.
          </p>
          <form action={startMockSession} className="flex flex-wrap gap-4">
            <input type="hidden" name="track" value={me.ielts_track} />
            <button
              type="submit"
              className="inline-flex items-center gap-2 rounded-pill bg-brand-red px-6 py-3 font-heading font-bold text-white border border-brand-red transition-colors hover:bg-brand-red-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2"
            >
              Begin Full Mock
            </button>
          </form>
          <p className="font-body text-xs text-brand-grey-500">
            You can step away — your mock saves as you go. Coming back to{" "}
            <code>/mock/{"<id>"}</code> resumes from the current section.
          </p>
        </section>

        {recent.length > 0 ? (
          <section>
            <h2 className="font-heading font-bold text-xl text-brand-black mb-3">
              Your recent mocks
            </h2>
            <ul className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 divide-y divide-brand-grey-200">
              {recent.map((r) => (
                <li
                  key={r.id}
                  className="flex items-center justify-between px-5 py-4"
                >
                  <div>
                    <p className="font-heading font-bold text-sm text-brand-black">
                      {r.track === "Academic" ? "Academic" : "General Training"}
                      {" · "}
                      {r.status}
                    </p>
                    <p className="font-body text-xs text-brand-grey-500">
                      Started {r.started_at.toISOString().slice(0, 10)}
                      {r.submitted_at
                        ? ` · finished ${r.submitted_at.toISOString().slice(0, 10)}`
                        : null}
                    </p>
                  </div>
                  <Link
                    href={
                      r.status === "Submitted"
                        ? `/mock/${r.id}/result`
                        : `/mock/${r.id}`
                    }
                    className="inline-flex items-center rounded-pill bg-brand-black text-white font-heading font-bold text-sm px-4 py-2 hover:bg-brand-grey-900"
                  >
                    {r.status === "Submitted"
                      ? "Open result"
                      : r.status === "InProgress"
                        ? "Resume"
                        : "View"}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </section>
  );
}
