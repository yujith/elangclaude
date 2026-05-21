import type { Metadata } from "next";
import Link from "next/link";
import { parseListeningContent, parseReadingPassage } from "@elc/ai";
import { withSuperAdminContext, type Section, type Track } from "@elc/db";
import { requireRole } from "@/lib/auth/context";

export const metadata: Metadata = {
  title: "Content moderation · SuperAdmin",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

const SECTIONS: readonly Section[] = ["Reading", "Listening", "Writing", "Speaking"];
const SECTION_PATHS: Record<Section, string> = {
  Reading: "reading",
  Listening: "listening",
  Writing: "writing",
  Speaking: "speaking",
};
const TRACKS: readonly Track[] = ["Academic", "GeneralTraining"];

type SearchParams = {
  section?: string;
  track?: string;
  difficulty?: string;
};

function parseSection(raw: unknown): Section | null {
  return SECTIONS.includes(raw as Section) ? (raw as Section) : null;
}

function parseTrack(raw: unknown): Track | null {
  return TRACKS.includes(raw as Track) ? (raw as Track) : null;
}

function parseDifficulty(raw: unknown): number | null {
  const n =
    typeof raw === "string" ? Number.parseInt(raw, 10) : Number.NaN;
  if (!Number.isInteger(n) || n < 1 || n > 5) return null;
  return n;
}

function sectionBadgeClasses(section: Section): string {
  if (section === "Reading") return "bg-brand-black text-white";
  if (section === "Writing") return "bg-brand-grey-900 text-white";
  if (section === "Listening") return "bg-brand-grey-700 text-white";
  return "bg-brand-grey-500 text-white";
}

function difficultyDots(level: number): string {
  const filled = Math.max(1, Math.min(5, level));
  return "●".repeat(filled) + "○".repeat(5 - filled);
}

function clipPreview(text: string | null | undefined, max = 110): string | null {
  if (!text) return null;
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (oneLine.length === 0) return null;
  if (oneLine.length <= max) return oneLine;
  return oneLine.slice(0, max - 1).trimEnd() + "…";
}

function previewFor(test: {
  section: Section;
  body_json: unknown;
  questions: { prompt: string }[];
}): string | null {
  switch (test.section) {
    case "Reading":
      return clipPreview(parseReadingPassage(test.body_json)?.title);
    case "Listening": {
      // Listening has no top-level title; Part 1's title is the natural
      // "what is this about" string for the queue. Fall back to Part 2 if
      // Part 1 ever lacks one (shouldn't, per the parser, but cheap to guard).
      const content = parseListeningContent(test.body_json);
      const partTitle =
        content?.parts.find((p) => p.title && p.title.length > 0)?.title ??
        null;
      return clipPreview(partTitle);
    }
    case "Writing":
    case "Speaking":
      // No body-level title; first question's prompt is the canonical
      // entry point a reviewer would read. Clip to a single line.
      return clipPreview(test.questions[0]?.prompt);
  }
}

function buildFilterHref(
  current: { section: Section | null; track: Track | null; difficulty: number | null },
  patch: Partial<{ section: Section | null; track: Track | null; difficulty: number | null }>,
): string {
  const next = { ...current, ...patch };
  const params = new URLSearchParams();
  if (next.section) params.set("section", next.section);
  if (next.track) params.set("track", next.track);
  if (next.difficulty) params.set("difficulty", String(next.difficulty));
  const query = params.toString();
  return query ? `/content?${query}` : "/content";
}

export default async function ContentInboxPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const ctx = await requireRole("SuperAdmin");
  const db = withSuperAdminContext(ctx);
  const sp = await searchParams;

  const sectionFilter = parseSection(sp.section);
  const trackFilter = parseTrack(sp.track);
  const difficultyFilter = parseDifficulty(sp.difficulty);

  const filterWhere = {
    status: "PendingReview" as const,
    ...(sectionFilter ? { section: sectionFilter } : {}),
    ...(trackFilter ? { track: trackFilter } : {}),
    ...(difficultyFilter ? { difficulty: difficultyFilter } : {}),
  };

  const [pending, perSectionCounts] = await Promise.all([
    db.test.findMany({
      where: filterWhere,
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE,
      select: {
        id: true,
        section: true,
        track: true,
        difficulty: true,
        createdAt: true,
        // body_json carries the canonical title for Reading + Listening;
        // first question prompt is the fallback for Writing + Speaking.
        body_json: true,
        questions: {
          select: { prompt: true },
          orderBy: { position: "asc" },
          take: 1,
        },
        _count: { select: { questions: true } },
      },
    }),
    db.test.groupBy({
      by: ["section"],
      where: { status: "PendingReview" },
      _count: { _all: true },
    }),
  ]);

  const pendingBySection = new Map<Section, number>(
    perSectionCounts.map((r) => [r.section, r._count._all]),
  );

  const current = {
    section: sectionFilter,
    track: trackFilter,
    difficulty: difficultyFilter,
  };

  return (
    <section className="px-6 py-12 md:py-16">
      <div className="mx-auto max-w-6xl space-y-10">
        <header>
          <p className="font-body text-sm uppercase tracking-widest text-brand-red">
            SuperAdmin
          </p>
          <h1 className="mt-2 font-display italic font-bold text-4xl md:text-5xl text-brand-black leading-tight">
            Content queue.
          </h1>
          <p className="mt-3 font-body text-base text-brand-grey-700 max-w-2xl">
            Every test currently <code>PendingReview</code> across all four
            sections. Click <em>Review</em> on a row to open the section-specific
            approval surface &mdash; nothing here bypasses the contract guards.
          </p>
        </header>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {SECTIONS.map((s) => {
            const count = pendingBySection.get(s) ?? 0;
            const isActive = sectionFilter === s;
            return (
              <Link
                key={s}
                href={buildFilterHref(current, {
                  section: isActive ? null : s,
                })}
                className={`rounded-lg ring-1 p-5 transition-colors ${
                  isActive
                    ? "bg-brand-black text-white ring-brand-black"
                    : "bg-brand-white ring-brand-grey-200 hover:ring-brand-red"
                }`}
              >
                <p
                  className={`font-body text-xs uppercase tracking-widest ${
                    isActive ? "text-brand-grey-200" : "text-brand-grey-500"
                  }`}
                >
                  {s}
                </p>
                <p
                  className={`mt-1 font-display italic font-bold text-3xl leading-none ${
                    isActive ? "text-white" : "text-brand-black"
                  }`}
                >
                  {count}
                </p>
                <p
                  className={`mt-1 font-body text-xs ${
                    isActive ? "text-brand-grey-200" : "text-brand-grey-500"
                  }`}
                >
                  pending
                </p>
              </Link>
            );
          })}
        </div>

        <section className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 p-5 flex flex-wrap items-center gap-3">
          <span className="font-heading font-bold text-xs uppercase tracking-wide text-brand-grey-600">
            Filter
          </span>
          <FilterChip
            label={trackFilter ? trackFilter.replace("GeneralTraining", "General Training") : "Any track"}
            active={trackFilter !== null}
            href={buildFilterHref(current, { track: null })}
          />
          {TRACKS.map((t) => (
            <FilterChip
              key={t}
              label={t === "GeneralTraining" ? "General Training" : t}
              active={trackFilter === t}
              href={buildFilterHref(current, {
                track: trackFilter === t ? null : t,
              })}
            />
          ))}
          <span className="mx-2 text-brand-grey-300">|</span>
          <FilterChip
            label={difficultyFilter ? `Difficulty ${difficultyFilter}` : "Any difficulty"}
            active={difficultyFilter !== null}
            href={buildFilterHref(current, { difficulty: null })}
          />
          {[1, 2, 3, 4, 5].map((d) => (
            <FilterChip
              key={d}
              label={String(d)}
              active={difficultyFilter === d}
              href={buildFilterHref(current, {
                difficulty: difficultyFilter === d ? null : d,
              })}
            />
          ))}
          {sectionFilter || trackFilter || difficultyFilter ? (
            <Link
              href="/content"
              className="ml-auto font-body text-sm text-brand-grey-700 hover:text-brand-black underline-offset-4 hover:underline"
            >
              Clear filters
            </Link>
          ) : null}
        </section>

        <section className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 p-5">
          <h2 className="font-heading font-bold text-base text-brand-black">
            Generate new content
          </h2>
          <p className="mt-1 font-body text-sm text-brand-grey-700">
            Each section has its own generation form. The buttons below open the
            section&rsquo;s console.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {SECTIONS.map((s) => (
              <Link
                key={s}
                href={`/content/${SECTION_PATHS[s]}`}
                className="inline-flex items-center rounded-pill border border-brand-grey-300 bg-brand-white px-4 py-1.5 font-heading font-bold text-xs text-brand-black hover:bg-brand-grey-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 transition-colors"
              >
                Generate {s} →
              </Link>
            ))}
          </div>
        </section>

        <section>
          <h2 className="font-heading font-bold text-xl text-brand-black mb-4">
            Pending review ({pending.length}
            {pending.length === PAGE_SIZE ? "+" : ""})
          </h2>
          <div className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 overflow-hidden">
            {pending.length === 0 ? (
              <p className="px-6 py-8 font-body text-base text-brand-grey-700">
                Nothing pending under these filters. Generate new content above
                or clear filters to widen the view.
              </p>
            ) : (
              <table className="w-full text-left">
                <thead className="bg-brand-grey-50">
                  <tr>
                    <Th>Section</Th>
                    <Th>Track</Th>
                    <Th>Difficulty</Th>
                    <Th>Questions</Th>
                    <Th>Generated</Th>
                    <Th>{""}</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-grey-200">
                  {pending.map((t) => {
                    const preview = previewFor(t);
                    return (
                    <tr key={t.id}>
                      <Td>
                        <div className="flex flex-col gap-1.5 max-w-md">
                          <span
                            className={`inline-flex w-fit items-center rounded-pill px-3 py-1 font-heading font-bold text-xs ${sectionBadgeClasses(t.section)}`}
                          >
                            {t.section}
                          </span>
                          {preview ? (
                            <span className="font-body text-sm text-brand-grey-700 leading-snug">
                              {preview}
                            </span>
                          ) : (
                            <span className="font-body text-xs italic text-brand-grey-500">
                              (untitled — review to inspect)
                            </span>
                          )}
                        </div>
                      </Td>
                      <Td>
                        <span className="font-body text-sm text-brand-grey-700">
                          {t.track === "Academic" ? "Academic" : "General Training"}
                        </span>
                      </Td>
                      <Td>
                        <span
                          className="font-body text-xs text-brand-grey-500"
                          title={`Difficulty ${t.difficulty} of 5`}
                          aria-label={`Difficulty ${t.difficulty} of 5`}
                        >
                          {difficultyDots(t.difficulty)}
                        </span>
                      </Td>
                      <Td>
                        <span className="font-body text-sm text-brand-grey-700 tabular-nums">
                          {t._count.questions}
                        </span>
                      </Td>
                      <Td>
                        <time
                          dateTime={t.createdAt.toISOString()}
                          className="font-body text-sm text-brand-grey-700"
                        >
                          {t.createdAt.toISOString().slice(0, 10)}
                        </time>
                      </Td>
                      <Td>
                        <Link
                          href={`/content/${SECTION_PATHS[t.section]}/${t.id}`}
                          className="inline-flex items-center rounded-pill bg-brand-red px-4 py-1.5 font-heading font-bold text-xs text-white border border-brand-red transition-colors hover:bg-brand-red-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2"
                        >
                          Review →
                        </Link>
                      </Td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          {pending.length === PAGE_SIZE ? (
            <p className="mt-3 font-body text-xs text-brand-grey-500">
              Showing the {PAGE_SIZE} newest. Narrow with the filters above to
              see older items.
            </p>
          ) : null}
        </section>
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

function FilterChip({
  label,
  active,
  href,
}: {
  label: string;
  active: boolean;
  href: string;
}) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center rounded-pill px-3 py-1.5 font-heading font-bold text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 ${
        active
          ? "bg-brand-black text-white"
          : "bg-brand-white text-brand-grey-700 border border-brand-grey-300 hover:bg-brand-grey-50"
      }`}
    >
      {label}
    </Link>
  );
}
