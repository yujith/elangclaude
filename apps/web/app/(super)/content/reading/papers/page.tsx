import type { Metadata } from "next";
import Link from "next/link";
import { withSuperAdminContext } from "@elc/db";
import { parseReadingPassage, paperIsComplete, readingPart } from "@elc/ai";
import { requireRole } from "@/lib/auth/context";
import { SubmitButton } from "@/components/ui/submit-button";
import { ConfirmSubmitButton } from "@/components/ui/confirm-submit-button";
import {
  approveReadingPaper,
  curateReadingPaperForm,
  deleteReadingPaper,
  generateReadingPaperForm,
} from "@/lib/reading/paper-actions";

export const metadata: Metadata = {
  title: "Reading papers",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type SearchParams = {
  curated?: string;
  generated?: string;
  approved?: string;
  deleted?: string;
  paper_error?: string;
  paper_issues?: string;
  failed_slot?: string;
  generate_error?: string;
};

type ApprovedTest = {
  id: string;
  track: "Academic" | "GeneralTraining";
  difficulty: number;
  body_json: unknown;
};

function testOptionLabel(t: ApprovedTest): string {
  const passage = parseReadingPassage(t.body_json);
  const title = passage?.title ?? "(untitled)";
  const part = passage ? readingPart(passage) : null;
  const trackLabel = t.track === "Academic" ? "AC" : "GT";
  const partLabel = part ? `P${part}` : "P—";
  return `${trackLabel} · ${partLabel} · L${t.difficulty} · ${title}`;
}

export default async function ReadingPapersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const ctx = await requireRole("SuperAdmin");
  const db = withSuperAdminContext(ctx);
  const sp = await searchParams;

  const [papers, approvedTests] = await Promise.all([
    db.readingPaper.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        track: true,
        status: true,
        title: true,
        createdAt: true,
        _count: { select: { sittings: true } },
        parts: {
          orderBy: { slot: "asc" },
          select: {
            slot: true,
            test: {
              select: {
                id: true,
                track: true,
                section: true,
                status: true,
                body_json: true,
              },
            },
          },
        },
      },
    }),
    db.test.findMany({
      where: { section: "Reading", status: "Approved" },
      orderBy: [{ track: "asc" }, { difficulty: "asc" }, { createdAt: "desc" }],
      take: 200,
      select: { id: true, track: true, difficulty: true, body_json: true },
    }),
  ]);

  return (
    <section className="px-6 py-12 md:py-16">
      <div className="mx-auto max-w-6xl space-y-10">
        <header>
          <p className="font-body text-sm uppercase tracking-widest text-brand-red">
            Content moderation
          </p>
          <h1 className="mt-2 font-display italic font-bold text-4xl md:text-5xl text-brand-black leading-tight">
            Reading papers.
          </h1>
          <p className="mt-3 font-body text-base text-brand-grey-700 max-w-2xl">
            A full Reading paper bundles three approved passages (Part 1–3)
            into one 60-minute sitting. Curate from the approved pool, or
            generate a fresh set.{" "}
            <Link
              href="/content/reading"
              className="font-heading font-bold text-brand-red hover:underline"
            >
              Back to the passage queue
            </Link>
            .
          </p>
        </header>

        {sp.curated ? (
          <Banner tone="success">
            Curated paper <code>{sp.curated}</code> — Approved and ready for
            learners.
          </Banner>
        ) : null}
        {sp.generated ? (
          <Banner tone="success">
            Generated paper <code>{sp.generated}</code> as a Draft. Approve
            each of its three passages in the queue, then approve the paper
            below.
          </Banner>
        ) : null}
        {sp.approved ? (
          <Banner tone="success">
            Approved paper <code>{sp.approved}</code> — it is now offered in
            the learner full-paper picker.
          </Banner>
        ) : null}
        {sp.deleted ? (
          <Banner tone="warn">
            Deleted paper <code>{sp.deleted}</code>.
          </Banner>
        ) : null}
        {sp.paper_error ? (
          <Banner tone="error">
            {paperErrorMessage(sp.paper_error, sp)}
          </Banner>
        ) : null}

        <GenerateCard />
        <CurateCard approvedTests={approvedTests} />

        <section>
          <h2 className="font-heading font-bold text-xl text-brand-black mb-4">
            Papers ({papers.length})
          </h2>
          {papers.length === 0 ? (
            <div className="rounded-lg bg-brand-white p-6 ring-1 ring-brand-grey-200">
              <p className="font-body text-base text-brand-grey-700">
                No papers yet. Generate or curate one above.
              </p>
            </div>
          ) : (
            <ul className="space-y-4">
              {papers.map((p) => {
                const candidates = p.parts.map((part) => ({
                  slot: part.slot as 1 | 2 | 3,
                  testId: part.test.id,
                  track: part.test.track,
                  section: part.test.section,
                  status: part.test.status,
                }));
                const complete = paperIsComplete(p.track, candidates);
                const trackLabel =
                  p.track === "Academic" ? "Academic" : "General Training";
                return (
                  <li
                    key={p.id}
                    className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 p-6 space-y-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center rounded-pill bg-brand-black text-white font-heading font-bold text-xs px-3 py-1">
                          {trackLabel}
                        </span>
                        <StatusPill status={p.status} />
                        {p._count.sittings > 0 ? (
                          <span className="font-body text-xs text-brand-grey-500">
                            {p._count.sittings} sitting
                            {p._count.sittings === 1 ? "" : "s"}
                          </span>
                        ) : null}
                      </div>
                      <span className="font-body text-xs text-brand-grey-500">
                        {p.createdAt.toISOString().slice(0, 16).replace("T", " ")}{" "}
                        UTC
                      </span>
                    </div>
                    <h3 className="font-heading font-bold text-lg text-brand-black">
                      {p.title || "Untitled paper"}
                    </h3>
                    <ol className="space-y-1">
                      {[1, 2, 3].map((slot) => {
                        const part = p.parts.find((x) => x.slot === slot);
                        const passage = part
                          ? parseReadingPassage(part.test.body_json)
                          : null;
                        return (
                          <li
                            key={slot}
                            className="flex items-center gap-3 font-body text-sm text-brand-grey-700"
                          >
                            <span className="font-heading font-bold text-brand-black">
                              Part {slot}
                            </span>
                            {part ? (
                              <>
                                <span className="truncate">
                                  {passage?.title ?? "(untitled passage)"}
                                </span>
                                <StatusPill status={part.test.status} small />
                              </>
                            ) : (
                              <span className="text-brand-red">
                                — missing —
                              </span>
                            )}
                          </li>
                        );
                      })}
                    </ol>
                    <div className="flex flex-wrap gap-3 pt-1">
                      {p.status !== "Approved" ? (
                        <form action={approveReadingPaper}>
                          <input type="hidden" name="paperId" value={p.id} />
                          <SubmitButton
                            pendingLabel="Approving…"
                            disabled={!complete}
                            className="inline-flex items-center rounded-pill bg-brand-red px-4 py-2 font-heading font-bold text-sm text-white border border-brand-red transition-colors hover:bg-brand-red-dark disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {complete
                              ? "Approve paper"
                              : "Approve (parts pending)"}
                          </SubmitButton>
                        </form>
                      ) : null}
                      <form action={deleteReadingPaper}>
                        <input type="hidden" name="paperId" value={p.id} />
                        <ConfirmSubmitButton
                          pendingLabel="Deleting…"
                          confirmMessage={
                            p._count.sittings > 0
                              ? `Delete this paper? ${p._count.sittings} learner sitting${p._count.sittings === 1 ? "" : "s"} will be detached — their reading attempts and grades are kept, but the sitting wrapper is removed.`
                              : "Delete this paper? The three passages stay in the pool."
                          }
                          className="inline-flex items-center rounded-pill px-4 py-2 font-heading font-bold text-sm text-brand-grey-700 ring-1 ring-brand-grey-300 transition-colors hover:text-brand-black"
                        >
                          {p._count.sittings > 0
                            ? `Delete (${p._count.sittings} sitting${p._count.sittings === 1 ? "" : "s"})`
                            : "Delete"}
                        </ConfirmSubmitButton>
                      </form>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </section>
  );
}

function GenerateCard() {
  return (
    <section className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 p-6">
      <h2 className="font-heading font-bold text-lg text-brand-black mb-1">
        Generate a fresh paper
      </h2>
      <p className="font-body text-sm text-brand-grey-700 mb-3">
        Runs the passage generator three times (ascending difficulty). The
        three passages land as <code>PendingReview</code> and the paper as a{" "}
        <code>Draft</code>; approve the passages, then the paper.
      </p>
      <form
        action={generateReadingPaperForm}
        className="flex flex-wrap items-end gap-4"
      >
        <Field label="Track">
          <select
            name="track"
            defaultValue="Academic"
            className="rounded-md ring-1 ring-brand-grey-300 bg-white px-3 py-2 font-body text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red"
          >
            <option value="Academic">Academic</option>
            <option value="GeneralTraining">General Training</option>
          </select>
        </Field>
        <Field label="Title (optional)" className="flex-1 min-w-[14rem]">
          <input
            name="title"
            type="text"
            placeholder="e.g. Academic Reading — Set 4"
            className="w-full rounded-md ring-1 ring-brand-grey-300 bg-white px-3 py-2 font-body text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red"
          />
        </Field>
        <SubmitButton
          pendingLabel="Generating 3 passages…"
          className="inline-flex items-center rounded-pill bg-brand-red px-5 py-2.5 font-heading font-bold text-white border border-brand-red transition-colors hover:bg-brand-red-dark disabled:opacity-60"
        >
          Generate paper
        </SubmitButton>
      </form>
    </section>
  );
}

function CurateCard({ approvedTests }: { approvedTests: ApprovedTest[] }) {
  return (
    <section className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 p-6">
      <h2 className="font-heading font-bold text-lg text-brand-black mb-1">
        Curate from approved passages
      </h2>
      <p className="font-body text-sm text-brand-grey-700 mb-3">
        Bundle three already-approved passages of the same track. The paper is
        Approved immediately.
      </p>
      {approvedTests.length < 3 ? (
        <p className="font-body text-sm text-brand-grey-500">
          Need at least three approved Reading passages to curate a paper.
        </p>
      ) : (
        <form
          action={curateReadingPaperForm}
          className="grid gap-4 sm:grid-cols-2"
        >
          <Field label="Track">
            <select
              name="track"
              defaultValue="Academic"
              className="w-full rounded-md ring-1 ring-brand-grey-300 bg-white px-3 py-2 font-body text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red"
            >
              <option value="Academic">Academic</option>
              <option value="GeneralTraining">General Training</option>
            </select>
          </Field>
          <Field label="Title (optional)">
            <input
              name="title"
              type="text"
              placeholder="e.g. GT Reading — Set 2"
              className="w-full rounded-md ring-1 ring-brand-grey-300 bg-white px-3 py-2 font-body text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red"
            />
          </Field>
          {[1, 2, 3].map((slot) => (
            <Field key={slot} label={`Part ${slot} passage`}>
              <select
                name={`slot${slot}`}
                required
                defaultValue=""
                className="w-full rounded-md ring-1 ring-brand-grey-300 bg-white px-3 py-2 font-body text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red"
              >
                <option value="" disabled>
                  Pick a passage…
                </option>
                {approvedTests.map((t) => (
                  <option key={t.id} value={t.id}>
                    {testOptionLabel(t)}
                  </option>
                ))}
              </select>
            </Field>
          ))}
          <div className="sm:col-span-2">
            <SubmitButton
              pendingLabel="Curating…"
              className="inline-flex items-center rounded-pill bg-brand-red px-5 py-2.5 font-heading font-bold text-white border border-brand-red transition-colors hover:bg-brand-red-dark disabled:opacity-60"
            >
              Curate paper
            </SubmitButton>
          </div>
        </form>
      )}
    </section>
  );
}

function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <label className="block font-heading font-bold text-xs uppercase tracking-wide text-brand-grey-600 mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}

function StatusPill({
  status,
  small,
}: {
  status: string;
  small?: boolean;
}) {
  const tone =
    status === "Approved"
      ? "bg-brand-black text-white"
      : status === "PendingReview"
        ? "ring-1 ring-brand-grey-300 text-brand-grey-700"
        : status === "Rejected"
          ? "bg-brand-red-soft text-brand-grey-900 ring-1 ring-brand-red/40"
          : "ring-1 ring-brand-grey-300 text-brand-grey-600";
  const size = small ? "text-[10px] px-2 py-0.5" : "text-xs px-3 py-1";
  return (
    <span
      className={`inline-flex items-center rounded-pill font-heading font-bold ${size} ${tone}`}
    >
      {status}
    </span>
  );
}

function paperErrorMessage(code: string, sp: SearchParams): string {
  const issues = sp.paper_issues ? ` (${sp.paper_issues})` : "";
  switch (code) {
    case "invalid_parts":
      return `Could not curate: the chosen passages failed validation${issues}.`;
    case "incomplete":
      return `Paper can't be approved yet — all three parts must be Approved passages of the right track${issues}.`;
    case "generate_failed":
      return `Generation failed at Part ${sp.failed_slot ?? "?"} (${sp.generate_error ?? "unknown"}). Any earlier passages were kept in the queue.`;
    case "bad_request":
      return "Missing or invalid input.";
    default:
      return `Action failed: ${code}.`;
  }
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
