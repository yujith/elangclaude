import type { Metadata } from "next";
import { withOrg } from "@elc/db";
import { prisma } from "@elc/db/client";
import { requireRole } from "@/lib/auth/context";
import { InvitePanel } from "@/components/admin/invite-panel";
import {
  softDeleteLearnerFromForm,
  updateLearnerFromForm,
} from "@/lib/admin/invite-actions";

export const metadata: Metadata = {
  title: "Org admin · Learners",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
const ERROR_COPY: Record<string, string> = {
  invalid_email: "That email address is not valid.",
  invalid_track: "That IELTS track is not valid.",
  cannot_use_email:
    "That email cannot be used here. It may already belong to another account.",
  learner_not_found: "That learner could not be found.",
  learner_deleted: "That learner has already been removed.",
};

export default async function OrgAdminLearnersPage({
  searchParams,
}: {
  searchParams: Promise<{
    updated?: string;
    removed?: string;
    error?: string;
    focus?: string;
  }>;
}) {
  const ctx = await requireRole("OrgAdmin");
  const db = withOrg(ctx);
  const sp = await searchParams;

  const [org, learners, activeLearnerCount, learnerCountAll] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: ctx.org_id },
      select: { seat_limit: true },
    }),
    db.user.findMany({
      // Soft-deleted learners are hidden from the roster but still count
      // against seat_limit (see Phase 2 Q1). Restore is a SuperAdmin op.
      where: { role: "Learner", deleted_at: null },
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE,
      select: {
        id: true,
        email: true,
        name: true,
        ielts_track: true,
        createdAt: true,
      },
    }),
    db.user.count({ where: { role: "Learner", deleted_at: null } }),
    db.user.count({ where: { role: "Learner" } }),
  ]);

  const seatLimit = org?.seat_limit ?? 0;
  const remaining = Math.max(0, seatLimit - learnerCountAll);
  const removedLearnerCount = Math.max(0, learnerCountAll - activeLearnerCount);
  const errorMessage = sp.error ? ERROR_COPY[sp.error] ?? sp.error : null;
  const focusUserId =
    typeof sp.focus === "string" && sp.focus.length > 0 ? sp.focus : null;

  return (
    <section className="px-6 py-12 md:py-16">
      <div className="mx-auto max-w-6xl space-y-10">
        <header>
          <p className="font-body text-sm uppercase tracking-widest text-brand-red">
            Org admin
          </p>
          <h1 className="mt-2 font-display italic font-bold text-4xl md:text-5xl text-brand-black leading-tight">
            Learners.
          </h1>
          <p className="mt-3 font-body text-base text-brand-grey-700 max-w-2xl">
            {seatLimit === 0
              ? "Your organisation has no seat limit configured. Contact support if that's unexpected."
              : `You have ${remaining} of ${seatLimit} seats remaining.`}
          </p>
          <p className="mt-2 font-body text-sm text-brand-grey-600 max-w-2xl">
            Removing a learner preserves their history and blocks sign-in, but
            their seat stays reserved in this phase.
          </p>
        </header>

        {sp.updated ? (
          <Banner tone="success">Learner details saved.</Banner>
        ) : null}
        {sp.removed ? (
          <Banner tone="warn">
            Learner removed. Their attempts and grades are preserved.
          </Banner>
        ) : null}
        {errorMessage ? <Banner tone="error">{errorMessage}</Banner> : null}

        <InvitePanel />

        <div>
          <h2 className="font-heading font-bold text-xl text-brand-black">
            Roster
          </h2>
          <p className="mt-1 font-body text-sm text-brand-grey-700">
            Showing the {Math.min(activeLearnerCount, PAGE_SIZE)} most recently
            added active learners
            {removedLearnerCount > 0 ? ` · ${removedLearnerCount} removed` : ""}
            .
          </p>
          <div className="mt-4 rounded-lg bg-brand-white ring-1 ring-brand-grey-200 overflow-hidden">
            {learners.length === 0 ? (
              <p className="px-6 py-8 font-body text-base text-brand-grey-700">
                {learnerCountAll === 0
                  ? "No learners yet. Invite your first one above."
                  : "All learners in this organisation have been removed."}
              </p>
            ) : (
              <table className="w-full text-left">
                <thead className="bg-brand-grey-50">
                  <tr>
                    <Th>Email</Th>
                    <Th>Name</Th>
                    <Th>Track</Th>
                    <Th>Added</Th>
                    <Th>Actions</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-grey-200">
                  {learners.map((l) => {
                    const formId = `learner-form-${l.id}`;
                    const focused = focusUserId === l.id;
                    return (
                      <tr
                        key={l.id}
                        id={`learner-${l.id}`}
                        className={
                          focused
                            ? "bg-brand-red-soft/40 ring-2 ring-brand-red ring-inset"
                            : ""
                        }
                      >
                        <Td>
                          <input
                            form={formId}
                            type="email"
                            name="email"
                            required
                            defaultValue={l.email}
                            className="w-full rounded-md border-0 ring-1 ring-brand-grey-200 px-3 py-2 font-body text-sm text-brand-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red"
                          />
                        </Td>
                        <Td>
                          <input
                            form={formId}
                            type="text"
                            name="name"
                            maxLength={200}
                            defaultValue={l.name ?? ""}
                            className="w-full rounded-md border-0 ring-1 ring-brand-grey-200 px-3 py-2 font-body text-sm text-brand-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red"
                            placeholder="Learner name"
                          />
                        </Td>
                        <Td>
                          <select
                            form={formId}
                            name="ielts_track"
                            defaultValue={l.ielts_track}
                            className="w-full rounded-md border-0 ring-1 ring-brand-grey-200 px-3 py-2 font-body text-sm text-brand-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red"
                          >
                            <option value="Academic">Academic</option>
                            <option value="GeneralTraining">General Training</option>
                          </select>
                        </Td>
                        <Td>
                          <time
                            dateTime={l.createdAt.toISOString()}
                            className="font-body text-sm text-brand-grey-700"
                          >
                            {l.createdAt.toLocaleDateString()}
                          </time>
                        </Td>
                        <Td>
                          <div className="flex flex-wrap items-center gap-2">
                            <form id={formId} action={updateLearnerFromForm}>
                              <input type="hidden" name="user_id" value={l.id} />
                            </form>
                            <button
                              form={formId}
                              type="submit"
                              className="inline-flex items-center rounded-pill border border-brand-grey-300 bg-brand-white px-3 py-1.5 font-heading font-bold text-xs text-brand-black hover:bg-brand-grey-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 transition-colors"
                            >
                              Save
                            </button>
                            <form action={softDeleteLearnerFromForm}>
                              <input type="hidden" name="user_id" value={l.id} />
                              <button
                                type="submit"
                                className="inline-flex items-center rounded-pill border border-brand-red/60 bg-brand-red-soft px-3 py-1.5 font-heading font-bold text-xs text-brand-grey-900 hover:bg-brand-red-soft/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 transition-colors"
                              >
                                Remove
                              </button>
                            </form>
                          </div>
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-6 py-3 font-body text-xs uppercase tracking-widest text-brand-grey-500">
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-6 py-3 align-middle">{children}</td>;
}

function Banner({
  tone,
  children,
}: {
  tone: "success" | "warn" | "error";
  children: React.ReactNode;
}) {
  const styles =
    tone === "error"
      ? "bg-brand-red-soft ring-brand-red/40 text-brand-grey-900"
      : tone === "warn"
        ? "bg-brand-grey-50 ring-brand-grey-300 text-brand-grey-900"
        : "bg-brand-white ring-brand-grey-200 text-brand-grey-900";
  return (
    <div className={`rounded-lg ring-1 px-5 py-3 ${styles}`}>
      <p className="font-body text-sm">{children}</p>
    </div>
  );
}
