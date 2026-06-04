import type { Metadata } from "next";
import { firstNameFrom, getLearnerDashboard } from "@elc/db";
import { requireOrgContext } from "@/lib/auth/context";
import { SectionStatTile } from "@/components/section-stat-tile";
import { ResumeStrip } from "@/components/resume-strip";
import { RecentAttempts } from "@/components/recent-attempts";

export const metadata: Metadata = {
  title: "Home",
};

export const dynamic = "force-dynamic";

const SECTIONS = ["Reading", "Listening", "Writing", "Speaking"] as const;

export default async function LearnerHomePage() {
  const ctx = await requireOrgContext();
  const dash = await getLearnerDashboard(ctx);

  const trackLabel =
    dash.user.ielts_track === "Academic" ? "Academic" : "General Training";
  const firstName = firstNameFrom(dash.user);

  return (
    <section className="px-6 py-12 md:py-20">
      <div className="mx-auto max-w-3xl space-y-12">
        <header className="space-y-2">
          <h1 className="font-display italic font-bold text-4xl md:text-5xl text-brand-black leading-tight">
            Welcome back, {firstName}.
          </h1>
          <p className="font-body text-sm text-brand-grey-700">
            {trackLabel} · {dash.org.name}
          </p>
        </header>

        <section aria-labelledby="where-you-are" className="space-y-5">
          <h2
            id="where-you-are"
            className="font-body text-xs uppercase tracking-widest text-brand-grey-700"
          >
            Where you are
          </h2>
          <ul className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-8 list-none p-0">
            {SECTIONS.map((s) => (
              <li key={s}>
                <SectionStatTile section={s} stat={dash.perSection[s]} />
              </li>
            ))}
          </ul>
        </section>

        <ResumeStrip
          // Full Mock is temporarily hidden (see learner-nav.tsx), so don't
          // surface a "continue your mock" link to a gated section.
          mockSession={null}
          attempt={dash.resume.attempt}
        />

        <section aria-labelledby="recently" className="space-y-3">
          <h2
            id="recently"
            className="font-body text-xs uppercase tracking-widest text-brand-grey-700"
          >
            Recently
          </h2>
          <RecentAttempts recent={dash.recent} />
        </section>

        {dash.quotaToday.limit > 0 ? (
          <p className="font-body text-xs text-brand-grey-700">
            {dash.quotaToday.used} of {dash.quotaToday.limit} daily AI calls
            used.
          </p>
        ) : null}
      </div>
    </section>
  );
}
