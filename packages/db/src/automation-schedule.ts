// Pure scheduling policy for content automation (ADR-0024).
//
// SuperAdmins schedule in THEIR timezone (default Australia/Sydney); the
// cron tick runs hourly in UTC. Everything timezone-shaped funnels through
// Intl.DateTimeFormat — no tz database dependency — and is DST-safe by
// construction: we always ask "what do the wall clocks in this zone read
// at this instant" rather than caching an offset (Sydney flips between
// +10:00 and +11:00 across its April/October DST boundaries).
//
// Due semantics (catch-up friendly — an outage of a few cron ticks must
// not silently skip a day):
//   OneOff    — due once `run_at` (a UTC instant, converted from the
//               local wall time at save) has passed and the schedule has
//               never run.
//   Recurring — due when the schedule-local wall clock has reached
//               `run_hour` today (and, for Weekly, today is `weekday`)
//               and the last run was not already today (schedule-local).
//               A tick missed at run_hour fires on the next tick that
//               same local day; a whole Weekly day missed waits a week.

export type DueCheckSchedule = {
  enabled: boolean;
  mode: "OneOff" | "Recurring";
  timezone: string;
  run_at: Date | null;
  frequency: "Daily" | "Weekly" | null;
  // 0 (Sunday) – 6 (Saturday), schedule-local.
  weekday: number | null;
  // 0–23, schedule-local.
  run_hour: number | null;
  last_run_at: Date | null;
};

export type LocalParts = {
  year: number;
  month: number; // 1–12
  day: number; // 1–31
  hour: number; // 0–23
  minute: number;
  weekday: number; // 0 (Sunday) – 6 (Saturday)
};

const WEEKDAYS: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

// Wall-clock reading of `date` in `timeZone`. Throws RangeError on an
// invalid IANA zone — callers validate zones at save time.
export function localParts(date: Date, timeZone: string): LocalParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) parts[p.type] = p.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: WEEKDAYS[parts.weekday ?? ""] ?? 0,
  };
}

// "YYYY-MM-DD" of `date` as read in `timeZone` — the day-identity used to
// enforce at-most-one-run-per-local-day.
export function localDateKey(date: Date, timeZone: string): string {
  const p = localParts(date, timeZone);
  const mm = String(p.month).padStart(2, "0");
  const dd = String(p.day).padStart(2, "0");
  return `${p.year}-${mm}-${dd}`;
}

// Convert a wall-clock time in `timeZone` to the UTC instant it names.
// Two correction passes handle DST: the first guess assumes UTC == local,
// the read-back tells us the real offset at (about) that instant, and one
// more pass settles times near a transition. For wall times skipped by a
// spring-forward jump this lands on the instant the clocks jumped to —
// acceptable for scheduling.
export function localDateTimeToUtc(
  wall: {
    year: number;
    month: number; // 1–12
    day: number;
    hour: number;
    minute?: number;
  },
  timeZone: string,
): Date {
  const minute = wall.minute ?? 0;
  const desired = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, minute);
  let guess = desired;
  for (let i = 0; i < 2; i++) {
    const got = localParts(new Date(guess), timeZone);
    const gotAsUtc = Date.UTC(got.year, got.month - 1, got.day, got.hour, got.minute);
    guess += desired - gotAsUtc;
  }
  return new Date(guess);
}

export function isScheduleDue(s: DueCheckSchedule, now: Date): boolean {
  if (!s.enabled) return false;

  if (s.mode === "OneOff") {
    return s.run_at !== null && s.run_at.getTime() <= now.getTime() && s.last_run_at === null;
  }

  // Recurring.
  if (s.run_hour === null || s.frequency === null) return false;
  const local = localParts(now, s.timezone);
  if (local.hour < s.run_hour) return false;
  if (s.frequency === "Weekly") {
    if (s.weekday === null || local.weekday !== s.weekday) return false;
  }
  if (
    s.last_run_at !== null &&
    localDateKey(s.last_run_at, s.timezone) === localDateKey(now, s.timezone)
  ) {
    // Already ran today (schedule-local).
    return false;
  }
  return true;
}

// Save-time validation for the timezone field — a bad zone would make
// every due-check throw. `Intl` is the authority on what's valid.
export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
