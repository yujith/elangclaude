import type { Metadata } from "next";
import Link from "next/link";
import { localParts, withSuperAdminContext } from "@elc/db";
import { requireRole } from "@/lib/auth/context";
import {
  createGenerationSchedule,
  deleteGenerationSchedule,
  runScheduleNow,
  setAutomationToggle,
  toggleGenerationSchedule,
} from "@/lib/automation/actions";
import { getAutomationSettings } from "@/lib/automation/settings";
import { SubmitButton } from "@/components/ui/submit-button";

export const metadata: Metadata = {
  title: "Content automation · SuperAdmin",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

const SCHEDULE_ERROR_MESSAGES: Record<string, string> = {
  section: "Pick a valid section.",
  track: "Pick a valid track.",
  difficulty: "Difficulty must be 1–5.",
  count: "Count is out of range for that section (Listening caps at 3).",
  task_kind: "Writing schedules need a task kind.",
  task_kind_track: "That Writing task kind implies the other track.",
  timezone: "That timezone is not a valid IANA zone.",
  mode: "Pick one-off or recurring.",
  run_at: "Pick a valid date and time for the one-off run.",
  run_at_past: "That date/time is in the past in the chosen timezone.",
  frequency: "Pick Daily or Weekly.",
  run_hour: "Run hour must be 0–23.",
  weekday: "Pick a weekday for the weekly schedule.",
};

function formatInZone(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: tz,
    dateStyle: "medium",
    timeStyle: "short",
    hour12: false,
  }).format(d);
}

function formatUtc(d: Date): string {
  return `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function scheduleWhen(s: {
  mode: "OneOff" | "Recurring";
  timezone: string;
  run_at: Date | null;
  frequency: "Daily" | "Weekly" | null;
  weekday: number | null;
  run_hour: number | null;
}): { local: string; utc: string | null } {
  if (s.mode === "OneOff") {
    if (!s.run_at) return { local: "—", utc: null };
    return {
      local: `${formatInZone(s.run_at, s.timezone)} (${s.timezone})`,
      utc: formatUtc(s.run_at),
    };
  }
  const hour = String(s.run_hour ?? 0).padStart(2, "0");
  const base =
    s.frequency === "Weekly"
      ? `Weekly · ${WEEKDAY_NAMES[s.weekday ?? 0]} ${hour}:00`
      : `Daily · ${hour}:00`;
  return { local: `${base} (${s.timezone})`, utc: null };
}

function trackLabel(track: string): string {
  return track === "GeneralTraining" ? "General Training" : track;
}

function runStatusClasses(status: string): string {
  if (status === "Succeeded") return "bg-brand-black text-white";
  if (status === "Running") return "bg-brand-grey-500 text-white";
  return "bg-brand-red text-white";
}

export default async function AutomationPage({
  searchParams,
}: {
  searchParams: Promise<{
    settings?: string;
    schedule?: string;
    schedule_error?: string;
  }>;
}) {
  const ctx = await requireRole("SuperAdmin");
  const db = withSuperAdminContext(ctx);
  const sp = await searchParams;

  const [settings, schedules, runs] = await Promise.all([
    getAutomationSettings(),
    db.generationSchedule.findMany({
      orderBy: { createdAt: "desc" },
      include: { creator: { select: { name: true, email: true } } },
    }),
    db.generationRun.findMany({
      orderBy: { started_at: "desc" },
      take: 20,
      include: { _count: { select: { items: true } } },
    }),
  ]);

  const scheduleError = sp.schedule_error
    ? (SCHEDULE_ERROR_MESSAGES[sp.schedule_error] ?? "Schedule was not saved.")
    : null;

  // Current Sydney wall clock — orientation for the person scheduling.
  const nowSydney = localParts(new Date(), "Australia/Sydney");

  return (
    <section className="px-6 py-12 md:py-16">
      <div className="mx-auto max-w-6xl space-y-10">
        <header>
          <p className="font-body text-sm uppercase tracking-widest text-brand-red">
            SuperAdmin
          </p>
          <h1 className="mt-2 font-display italic font-bold text-4xl md:text-5xl text-brand-black leading-tight">
            Content automation.
          </h1>
          <p className="mt-3 font-body text-base text-brand-grey-700 max-w-2xl">
            Scheduled generation with a model-reviews-model gate (gpt-4.1-mini
            generates, Claude Sonnet reviews). Reviewer-approved tests publish
            automatically when auto-publish is on; otherwise they land in the
            normal moderation queue pre-screened. Every verdict is recorded in
            run history.
          </p>
        </header>

        {sp.settings === "updated" ? (
          <Banner>Settings updated.</Banner>
        ) : null}
        {sp.schedule === "created" ? <Banner>Schedule created.</Banner> : null}
        {scheduleError ? <Banner error>{scheduleError}</Banner> : null}

        {/* ── Kill switches ─────────────────────────────────────────── */}
        <section className="grid gap-4 md:grid-cols-2">
          <ToggleCard
            title="Scheduled auto-generation"
            enabled={settings.generation_enabled}
            toggle="generation"
            description="Master switch for the hourly cron. When off, no scheduled runs fire — “Run now” still works as the rehearsal path."
          />
          <ToggleCard
            title="Auto-publish"
            enabled={settings.auto_publish_enabled}
            toggle="auto_publish"
            description="When on, reviewer-approved tests go straight to Approved and learners see them. When off, they wait in Pending review with the verdict attached."
          />
        </section>

        {/* ── New schedule ──────────────────────────────────────────── */}
        <section className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 p-6">
          <h2 className="font-heading font-bold text-lg text-brand-black mb-1">
            New schedule
          </h2>
          <p className="font-body text-sm text-brand-grey-700 mb-4">
            Times are wall-clock in the chosen timezone (default Sydney — it is
            currently{" "}
            {String(nowSydney.hour).padStart(2, "0")}:
            {String(nowSydney.minute).padStart(2, "0")} there). One-off
            schedules disable themselves after running. The scheduler
            currently ticks once a day around 18:00 Sydney (hosting-plan
            limit): schedules fire at the first tick after their time, so
            pick run hours before 18:00 — later hours won&rsquo;t fire until
            the plan allows hourly ticks.
          </p>
          <form
            action={createGenerationSchedule}
            className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          >
            <Field label="Section">
              <select name="section" defaultValue="Reading" className={inputCls}>
                <option value="Reading">Reading</option>
                <option value="Listening">Listening</option>
                <option value="Writing">Writing</option>
                <option value="Speaking">Speaking</option>
              </select>
            </Field>
            <Field label="Track">
              <select name="track" defaultValue="Academic" className={inputCls}>
                <option value="Academic">Academic</option>
                <option value="GeneralTraining">General Training</option>
              </select>
            </Field>
            <Field label="Difficulty (1–5)">
              <select name="difficulty" defaultValue="3" className={inputCls}>
                {[1, 2, 3, 4, 5].map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Tests per run (Listening max 3)">
              <select name="count" defaultValue="1" className={inputCls}>
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Reading part (Academic only, optional)">
              <select name="part" defaultValue="" className={inputCls}>
                <option value="">Any</option>
                <option value="1">Part 1</option>
                <option value="2">Part 2</option>
                <option value="3">Part 3</option>
              </select>
            </Field>
            <Field label="Writing task kind (Writing only)">
              <select name="task_kind" defaultValue="" className={inputCls}>
                <option value="">—</option>
                <option value="writing-task-1-academic">
                  Task 1 — Academic (visual)
                </option>
                <option value="writing-task-1-general">
                  Task 1 — General (letter)
                </option>
                <option value="writing-task-2">Task 2 — Essay</option>
              </select>
            </Field>
            <Field label="Topic hint (optional)">
              <input
                name="topic_hint"
                type="text"
                placeholder="e.g. urban wildlife"
                className={inputCls}
              />
            </Field>
            <Field label="Timezone (IANA)">
              <input
                name="timezone"
                type="text"
                defaultValue="Australia/Sydney"
                className={inputCls}
              />
            </Field>
            <Field label="Mode">
              <select name="mode" defaultValue="OneOff" className={inputCls}>
                <option value="OneOff">One-off (specific date)</option>
                <option value="Recurring">Recurring</option>
              </select>
            </Field>
            <Field label="One-off: date">
              <input name="run_date" type="date" className={inputCls} />
            </Field>
            <Field label="One-off: time (HH:MM)">
              <input
                name="run_time"
                type="time"
                defaultValue="09:00"
                className={inputCls}
              />
            </Field>
            <Field label="Recurring: frequency">
              <select name="frequency" defaultValue="Daily" className={inputCls}>
                <option value="Daily">Daily</option>
                <option value="Weekly">Weekly</option>
              </select>
            </Field>
            <Field label="Recurring: run hour (0–23)">
              <select name="run_hour" defaultValue="9" className={inputCls}>
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {String(h).padStart(2, "0")}:00
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Recurring weekly: weekday">
              <select name="weekday" defaultValue="1" className={inputCls}>
                {WEEKDAY_NAMES.map((name, i) => (
                  <option key={name} value={i}>
                    {name}
                  </option>
                ))}
              </select>
            </Field>
            <div className="sm:col-span-2 lg:col-span-3">
              <SubmitButton
                className={redPillCls}
                pendingLabel="Creating…"
              >
                Create schedule
              </SubmitButton>
            </div>
          </form>
        </section>

        {/* ── Schedules ─────────────────────────────────────────────── */}
        <section>
          <h2 className="font-heading font-bold text-xl text-brand-black mb-4">
            Schedules ({schedules.length})
          </h2>
          <div className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 overflow-hidden">
            {schedules.length === 0 ? (
              <p className="px-6 py-8 font-body text-base text-brand-grey-700">
                No schedules yet. Create one above — it only fires while
                scheduled auto-generation is on.
              </p>
            ) : (
              <table className="w-full text-left">
                <thead className="bg-brand-grey-50">
                  <tr>
                    <Th>What</Th>
                    <Th>When</Th>
                    <Th>Last run</Th>
                    <Th>Status</Th>
                    <Th>{""}</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-grey-200">
                  {schedules.map((s) => {
                    const when = scheduleWhen(s);
                    return (
                      <tr key={s.id}>
                        <Td>
                          <div className="flex flex-col gap-1 max-w-sm">
                            <span className="font-heading font-bold text-sm text-brand-black">
                              {s.section} · {trackLabel(s.track)} · L
                              {s.difficulty} · ×{s.count}
                            </span>
                            <span className="font-body text-xs text-brand-grey-500">
                              {s.task_kind ? `${s.task_kind} · ` : ""}
                              {s.part ? `Part ${s.part} · ` : ""}
                              {s.topic_hint ? `“${s.topic_hint}” · ` : ""}
                              by {s.creator?.name ?? s.creator?.email ?? "(deleted user)"}
                            </span>
                          </div>
                        </Td>
                        <Td>
                          <div className="flex flex-col gap-0.5">
                            <span className="font-body text-sm text-brand-grey-700">
                              {when.local}
                            </span>
                            {when.utc ? (
                              <span className="font-body text-xs text-brand-grey-500">
                                {when.utc}
                              </span>
                            ) : null}
                          </div>
                        </Td>
                        <Td>
                          <span className="font-body text-sm text-brand-grey-700">
                            {s.last_run_at ? formatUtc(s.last_run_at) : "never"}
                          </span>
                        </Td>
                        <Td>
                          <span
                            className={`inline-flex items-center rounded-pill px-3 py-1 font-heading font-bold text-xs ${
                              s.enabled
                                ? "bg-brand-black text-white"
                                : "bg-brand-grey-200 text-brand-grey-700"
                            }`}
                          >
                            {s.enabled ? "Enabled" : "Disabled"}
                          </span>
                        </Td>
                        <Td>
                          <div className="flex flex-wrap items-center gap-2">
                            <form action={runScheduleNow}>
                              <input type="hidden" name="scheduleId" value={s.id} />
                              <SubmitButton
                                className={redPillCls}
                                pendingLabel="Running…"
                              >
                                Run now
                              </SubmitButton>
                            </form>
                            <form action={toggleGenerationSchedule}>
                              <input type="hidden" name="scheduleId" value={s.id} />
                              <input
                                type="hidden"
                                name="enable"
                                value={s.enabled ? "0" : "1"}
                              />
                              <SubmitButton className={greyPillCls}>
                                {s.enabled ? "Disable" : "Enable"}
                              </SubmitButton>
                            </form>
                            <form action={deleteGenerationSchedule}>
                              <input type="hidden" name="scheduleId" value={s.id} />
                              <SubmitButton className={greyPillCls}>
                                Delete
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
        </section>

        {/* ── Run history ───────────────────────────────────────────── */}
        <section>
          <h2 className="font-heading font-bold text-xl text-brand-black mb-4">
            Run history
          </h2>
          <div className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 overflow-hidden">
            {runs.length === 0 ? (
              <p className="px-6 py-8 font-body text-base text-brand-grey-700">
                No runs yet.
              </p>
            ) : (
              <table className="w-full text-left">
                <thead className="bg-brand-grey-50">
                  <tr>
                    <Th>Started</Th>
                    <Th>What</Th>
                    <Th>Trigger</Th>
                    <Th>Status</Th>
                    <Th>Published / Pending / Failed</Th>
                    <Th>{""}</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-grey-200">
                  {runs.map((r) => (
                    <tr key={r.id}>
                      <Td>
                        <time
                          dateTime={r.started_at.toISOString()}
                          className="font-body text-sm text-brand-grey-700"
                        >
                          {formatUtc(r.started_at)}
                        </time>
                      </Td>
                      <Td>
                        <span className="font-body text-sm text-brand-grey-700">
                          {r.section} · {trackLabel(r.track)} · L{r.difficulty}{" "}
                          · ×{r.requested_count}
                        </span>
                      </Td>
                      <Td>
                        <span className="font-body text-sm text-brand-grey-700">
                          {r.trigger}
                        </span>
                      </Td>
                      <Td>
                        <span
                          className={`inline-flex items-center rounded-pill px-3 py-1 font-heading font-bold text-xs ${runStatusClasses(r.status)}`}
                        >
                          {r.status}
                        </span>
                      </Td>
                      <Td>
                        <span className="font-body text-sm text-brand-grey-700 tabular-nums">
                          {r.published_count} / {r.pending_count} /{" "}
                          {r.failed_count}
                        </span>
                      </Td>
                      <Td>
                        <Link
                          href={`/content/automation/runs/${r.id}`}
                          className="inline-flex items-center rounded-pill border border-brand-grey-300 bg-brand-white px-4 py-1.5 font-heading font-bold text-xs text-brand-black hover:bg-brand-grey-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 transition-colors"
                        >
                          Verdicts →
                        </Link>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>
    </section>
  );
}

const inputCls =
  "w-full rounded-md ring-1 ring-brand-grey-300 bg-white px-3 py-2 font-body text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red";

const redPillCls =
  "inline-flex items-center rounded-pill bg-brand-red px-4 py-1.5 font-heading font-bold text-xs text-white border border-brand-red transition-colors hover:bg-brand-red-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2";

const greyPillCls =
  "inline-flex items-center rounded-pill border border-brand-grey-300 bg-brand-white px-4 py-1.5 font-heading font-bold text-xs text-brand-black hover:bg-brand-grey-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 transition-colors";

function Banner({
  children,
  error = false,
}: {
  children: React.ReactNode;
  error?: boolean;
}) {
  return (
    <div
      role="status"
      className={`rounded-lg px-5 py-3 font-body text-sm ring-1 ${
        error
          ? "bg-brand-white text-brand-red-dark ring-brand-red"
          : "bg-brand-white text-brand-black ring-brand-grey-200"
      }`}
    >
      {children}
    </div>
  );
}

function ToggleCard({
  title,
  description,
  enabled,
  toggle,
}: {
  title: string;
  description: string;
  enabled: boolean;
  toggle: "generation" | "auto_publish";
}) {
  return (
    <div className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 p-6 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-heading font-bold text-lg text-brand-black">
          {title}
        </h2>
        <span
          className={`inline-flex items-center rounded-pill px-3 py-1 font-heading font-bold text-xs ${
            enabled ? "bg-brand-black text-white" : "bg-brand-grey-200 text-brand-grey-700"
          }`}
        >
          {enabled ? "On" : "Off"}
        </span>
      </div>
      <p className="font-body text-sm text-brand-grey-700">{description}</p>
      <form action={setAutomationToggle}>
        <input type="hidden" name="toggle" value={toggle} />
        <input type="hidden" name="value" value={enabled ? "off" : "on"} />
        <SubmitButton
          className={enabled ? greyPillCls : redPillCls}
          pendingLabel="Saving…"
        >
          {enabled ? "Turn off" : "Turn on"}
        </SubmitButton>
      </form>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-heading font-bold text-xs uppercase tracking-wide text-brand-grey-600">
        {label}
      </span>
      {children}
    </label>
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
