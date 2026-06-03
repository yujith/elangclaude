import type { Metadata } from "next";
import Link from "next/link";
import type { Track } from "@elc/db";
import { prisma } from "@elc/db/client";
import { loadOrgLearnerRoster } from "@elc/db/org-learner-admin";
import { requireRole } from "@/lib/auth/context";
import {
  softDeleteLearnerFromForm,
  updateLearnerFromForm,
} from "@/lib/admin/invite-actions";
import { SubmitButton } from "@/components/ui/submit-button";

export const metadata: Metadata = {
  title: "Org admin · Learners",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
const TRACKS: readonly Track[] = ["Academic", "GeneralTraining"];
type ActivityWindow = "today" | "week" | "month";
type InactiveWindow = "week" | "month";

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
    q?: string;
    page?: string;
    track?: string;
    activity?: string;
    inactive?: string;
    min_calls?: string;
  }>;
}) {
  const ctx = await requireRole("OrgAdmin");
  const sp = await searchParams;
  const q = normalizeQuery(sp.q);
  const track = parseTrack(sp.track);
  const activity = parseActivity(sp.activity);
  const inactive = activity ? null : parseInactive(sp.inactive);
  const minCalls = parseMinCalls(sp.min_calls);
  const requestedPage = parsePositiveInt(sp.page, 1);

  const [org, roster] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: ctx.org_id },
      select: { seat_limit: true },
    }),
    loadOrgLearnerRoster(ctx, {
      q,
      track,
      activity,
      inactive,
      minCalls,
      page: requestedPage,
      pageSize: PAGE_SIZE,
    }),
  ]);

  const seatLimit = org?.seat_limit ?? 0;
  const remaining = Math.max(0, seatLimit - roster.counts.all);
  const errorMessage = sp.error ? ERROR_COPY[sp.error] ?? sp.error : null;
  const focusUserId =
    typeof sp.focus === "string" && sp.focus.length > 0 ? sp.focus : null;
  const current = {
    q,
    page: roster.page.current,
    track,
    activity,
    inactive,
    minCalls,
  };
  const currentHref = buildHref(current, {});
  const hasFilters = Boolean(q || track || activity || inactive || minCalls);
  const emptyRosterMessage = hasFilters
    ? "No active learners match that search."
    : roster.counts.all === 0
      ? "No learners yet. Invite your first one above."
      : "All learners in this organisation have been removed.";

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
            Monitor learner usage, activity, and account details across your
            organisation.
          </p>
          {seatLimit > 0 ? (
            <p className="mt-2 font-body text-sm text-brand-grey-600 max-w-2xl">
              {remaining} of {seatLimit} seats remaining. Removed learners keep
              their history and continue to reserve seats in this phase.
            </p>
          ) : (
            <p className="mt-2 font-body text-sm text-brand-grey-600 max-w-2xl">
              Your organisation has no seat limit configured. Contact support
              if that&apos;s unexpected.
            </p>
          )}
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

        <div>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="font-heading font-bold text-xl text-brand-black">
                Roster
              </h2>
              <p className="mt-1 font-body text-sm text-brand-grey-700">
                {hasFilters
                  ? `Showing ${roster.page.rangeStart}-${roster.page.rangeEnd} of ${roster.counts.filtered} matching active learners`
                  : `Showing ${roster.page.rangeStart}-${roster.page.rangeEnd} of ${roster.counts.active} active learners`}
                {roster.counts.removed > 0
                  ? ` · ${roster.counts.removed} removed`
                  : ""}
                .
              </p>
            </div>
            <form
              action="/admin/learners"
              method="get"
              className="grid w-full gap-3 md:w-auto md:grid-cols-[minmax(15rem,1.2fr)_minmax(9rem,0.7fr)_minmax(9rem,0.7fr)_minmax(9rem,0.7fr)_minmax(8rem,0.6fr)_auto_auto] md:items-end"
            >
              <div className="min-w-[16rem]">
                <label
                  htmlFor="q"
                  className="block font-heading font-bold text-xs uppercase tracking-wide text-brand-grey-600 mb-1"
                >
                  Search email or name
                </label>
                <input
                  id="q"
                  name="q"
                  type="search"
                  defaultValue={q ?? ""}
                  placeholder="e.g. learner@example.com"
                  className="w-full rounded-md border-0 ring-1 ring-brand-grey-300 bg-white px-3 py-2 font-body text-sm text-brand-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red"
                />
              </div>
              <FilterSelect label="Track" name="track" value={track ?? ""}>
                <option value="">Any track</option>
                <option value="Academic">Academic</option>
                <option value="GeneralTraining">General Training</option>
              </FilterSelect>
              <FilterSelect label="Active" name="activity" value={activity ?? ""}>
                <option value="">Any activity</option>
                <option value="today">Today</option>
                <option value="week">This week</option>
                <option value="month">This month</option>
              </FilterSelect>
              <FilterSelect label="Inactive" name="inactive" value={inactive ?? ""}>
                <option value="">Any</option>
                <option value="week">No activity this week</option>
                <option value="month">No activity this month</option>
              </FilterSelect>
              <div>
                <label
                  htmlFor="min_calls"
                  className="block font-heading font-bold text-xs uppercase tracking-wide text-brand-grey-600 mb-1"
                >
                  Min calls
                </label>
                <input
                  id="min_calls"
                  name="min_calls"
                  type="number"
                  min={0}
                  step={1}
                  defaultValue={minCalls ?? ""}
                  className="w-full rounded-md border-0 ring-1 ring-brand-grey-300 bg-white px-3 py-2 font-body text-sm text-brand-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red"
                />
              </div>
              <button
                type="submit"
                className="inline-flex items-center rounded-pill bg-brand-red px-5 py-2.5 font-heading font-bold text-white border border-brand-red transition-colors hover:bg-brand-red-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2"
              >
                Search
              </button>
              {hasFilters ? (
                <Link
                  href="/admin/learners"
                  className="font-body text-sm text-brand-grey-700 hover:text-brand-black underline-offset-4 hover:underline"
                >
                  Clear filters
                </Link>
              ) : null}
            </form>
          </div>
          <div className="mt-4 rounded-lg bg-brand-white ring-1 ring-brand-grey-200 overflow-x-auto">
            {roster.learners.length === 0 ? (
              <p className="px-6 py-8 font-body text-base text-brand-grey-700">
                {emptyRosterMessage}
              </p>
            ) : (
              <table className="w-full min-w-[76rem] text-left">
                <thead className="bg-brand-grey-50">
                  <tr>
                    <Th>Learner</Th>
                    <Th>Track</Th>
                    <Th align="right">Today</Th>
                    <Th align="right">Week</Th>
                    <Th align="right">Month</Th>
                    <Th align="right">Attempts</Th>
                    <Th align="right">Latest band</Th>
                    <Th>Last active</Th>
                    <Th>Actions</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-grey-200">
                  {roster.learners.map((l) => {
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
                          <div className="min-w-[14rem]">
                            <p className="font-heading font-bold text-sm text-brand-black">
                              {l.name ?? "Unnamed learner"}
                            </p>
                            <p className="font-body text-xs text-brand-grey-700">
                              {l.email}
                            </p>
                            <p className="mt-1 font-body text-[11px] uppercase tracking-wide text-brand-grey-500">
                              Added {formatDate(l.createdAt)}
                            </p>
                          </div>
                        </Td>
                        <Td>
                          <span className="font-body text-sm text-brand-grey-700">
                            {formatTrack(l.ielts_track)}
                          </span>
                        </Td>
                        <Td align="right">
                          <Metric>{l.callsToday}</Metric>
                        </Td>
                        <Td align="right">
                          <Metric emphasis={l.callsWeek > 0}>{l.callsWeek}</Metric>
                        </Td>
                        <Td align="right">
                          <Metric>{l.callsMonth}</Metric>
                        </Td>
                        <Td align="right">
                          <Metric>{l.attemptsCount}</Metric>
                        </Td>
                        <Td align="right">
                          <Metric>
                            {l.latestBand === null ? "—" : l.latestBand.toFixed(1)}
                          </Metric>
                        </Td>
                        <Td>
                          {l.lastActivityAt ? (
                            <time
                              dateTime={l.lastActivityAt.toISOString()}
                              className="font-body text-sm text-brand-grey-700 whitespace-nowrap"
                            >
                              {formatDate(l.lastActivityAt)}
                            </time>
                          ) : (
                            <span className="font-body text-sm text-brand-grey-500">
                              —
                            </span>
                          )}
                        </Td>
                        <Td>
                          <div className="min-w-[10rem] space-y-2">
                            <details className="group">
                              <summary className="inline-flex cursor-pointer list-none items-center rounded-pill border border-brand-grey-300 bg-brand-white px-3 py-1.5 font-heading font-bold text-xs text-brand-black hover:bg-brand-grey-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 transition-colors">
                                Manage
                              </summary>
                              <div className="mt-3 w-[18rem] space-y-3 rounded-lg bg-brand-white p-3 ring-1 ring-brand-grey-200 shadow-sm">
                                <label className="block">
                                  <span className="block font-heading font-bold text-xs uppercase tracking-wide text-brand-grey-600 mb-1">
                                    Email
                                  </span>
                                  <input
                                    form={formId}
                                    type="email"
                                    name="email"
                                    required
                                    defaultValue={l.email}
                                    className="w-full rounded-md border-0 ring-1 ring-brand-grey-200 px-3 py-2 font-body text-sm text-brand-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red"
                                  />
                                </label>
                                <label className="block">
                                  <span className="block font-heading font-bold text-xs uppercase tracking-wide text-brand-grey-600 mb-1">
                                    Name
                                  </span>
                                  <input
                                    form={formId}
                                    type="text"
                                    name="name"
                                    maxLength={200}
                                    defaultValue={l.name ?? ""}
                                    className="w-full rounded-md border-0 ring-1 ring-brand-grey-200 px-3 py-2 font-body text-sm text-brand-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red"
                                    placeholder="Learner name"
                                  />
                                </label>
                                <label className="block">
                                  <span className="block font-heading font-bold text-xs uppercase tracking-wide text-brand-grey-600 mb-1">
                                    Track
                                  </span>
                                  <select
                                    form={formId}
                                    name="ielts_track"
                                    defaultValue={l.ielts_track}
                                    className="w-full rounded-md border-0 ring-1 ring-brand-grey-200 px-3 py-2 font-body text-sm text-brand-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red"
                                  >
                                    <option value="Academic">Academic</option>
                                    <option value="GeneralTraining">
                                      General Training
                                    </option>
                                  </select>
                                </label>
                                <button
                                  form={formId}
                                  type="submit"
                                  className="inline-flex items-center rounded-pill border border-brand-grey-300 bg-brand-white px-3 py-1.5 font-heading font-bold text-xs text-brand-black hover:bg-brand-grey-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 transition-colors"
                                >
                                  Save changes
                                </button>
                              </div>
                            </details>
                            <form id={formId} action={updateLearnerFromForm}>
                              <input type="hidden" name="user_id" value={l.id} />
                              <input
                                type="hidden"
                                name="return_to"
                                value={currentHref}
                              />
                            </form>
                            <form action={softDeleteLearnerFromForm}>
                              <input type="hidden" name="user_id" value={l.id} />
                              <input
                                type="hidden"
                                name="return_to"
                                value={currentHref}
                              />
                              <SubmitButton
                                pendingLabel="Removing…"
                                className="inline-flex items-center rounded-pill border border-brand-red/60 bg-brand-red-soft px-3 py-1.5 font-heading font-bold text-xs text-brand-grey-900 hover:bg-brand-red-soft/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                              >
                                Remove
                              </SubmitButton>
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
          {roster.counts.filtered > PAGE_SIZE ? (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="font-body text-sm text-brand-grey-700">
                Page {roster.page.current} of {roster.page.pageCount}
              </p>
              <div className="flex items-center gap-2">
                <PageLink
                  href={buildHref(current, { page: roster.page.current - 1 })}
                  disabled={roster.page.current <= 1}
                >
                  ← Newer
                </PageLink>
                <PageLink
                  href={buildHref(current, { page: roster.page.current + 1 })}
                  disabled={roster.page.current >= roster.page.pageCount}
                >
                  Older →
                </PageLink>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function normalizeQuery(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, 200);
}

function parsePositiveInt(raw: unknown, fallback: number): number {
  if (typeof raw !== "string") return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
}

function parseTrack(raw: unknown): Track | null {
  return TRACKS.includes(raw as Track) ? (raw as Track) : null;
}

function parseActivity(raw: unknown): ActivityWindow | null {
  return raw === "today" || raw === "week" || raw === "month" ? raw : null;
}

function parseInactive(raw: unknown): InactiveWindow | null {
  return raw === "week" || raw === "month" ? raw : null;
}

function parseMinCalls(raw: unknown): number | null {
  if (typeof raw !== "string" || raw.trim().length === 0) return null;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return null;
  return parsed;
}

function buildHref(
  current: {
    q: string | null;
    page: number;
    track: Track | null;
    activity: ActivityWindow | null;
    inactive: InactiveWindow | null;
    minCalls: number | null;
  },
  patch: Partial<{
    q: string | null;
    page: number;
    track: Track | null;
    activity: ActivityWindow | null;
    inactive: InactiveWindow | null;
    minCalls: number | null;
  }>,
): string {
  const next = { ...current, ...patch };
  const params = new URLSearchParams();
  if (next.q) params.set("q", next.q);
  if (next.track) params.set("track", next.track);
  if (next.activity) params.set("activity", next.activity);
  if (next.inactive && !next.activity) params.set("inactive", next.inactive);
  if (next.minCalls) params.set("min_calls", String(next.minCalls));
  if (next.page > 1) params.set("page", String(next.page));
  const qs = params.toString();
  return qs ? `/admin/learners?${qs}` : "/admin/learners";
}

function formatTrack(track: Track): string {
  return track === "GeneralTraining" ? "General Training" : "Academic";
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-AU", { timeZone: "UTC" });
}

function FilterSelect({
  label,
  name,
  value,
  children,
}: {
  label: string;
  name: string;
  value: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block font-heading font-bold text-xs uppercase tracking-wide text-brand-grey-600 mb-1">
        {label}
      </span>
      <select
        name={name}
        defaultValue={value}
        className="w-full rounded-md border-0 ring-1 ring-brand-grey-300 bg-white px-3 py-2 font-body text-sm text-brand-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red"
      >
        {children}
      </select>
    </label>
  );
}

function Metric({
  children,
  emphasis = false,
}: {
  children: React.ReactNode;
  emphasis?: boolean;
}) {
  return (
    <span
      className={`font-body text-sm tabular-nums ${
        emphasis ? "font-bold text-brand-black" : "text-brand-grey-700"
      }`}
    >
      {children}
    </span>
  );
}

function PageLink({
  href,
  disabled,
  children,
}: {
  href: string;
  disabled: boolean;
  children: React.ReactNode;
}) {
  if (disabled) {
    return (
      <span className="inline-flex items-center rounded-pill border border-brand-grey-200 bg-brand-grey-50 px-4 py-2 font-heading font-bold text-sm text-brand-grey-400">
        {children}
      </span>
    );
  }
  return (
    <Link
      href={href}
      className="inline-flex items-center rounded-pill border border-brand-grey-200 bg-brand-white px-4 py-2 font-heading font-bold text-sm text-brand-black hover:bg-brand-grey-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 transition-colors"
    >
      {children}
    </Link>
  );
}

function Th({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      className={`px-6 py-3 font-body text-xs uppercase tracking-widest text-brand-grey-500 ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <td
      className={`px-6 py-3 align-middle ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      {children}
    </td>
  );
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
