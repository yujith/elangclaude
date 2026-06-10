"use server";

// SuperAdmin-only server actions for content automation (ADR-0024):
// the two kill switches, GenerationSchedule CRUD, and "Run now".
//
// GenerationSchedule / AutomationSettings / GenerationRun are global
// content-pool models, so we use withSuperAdminContext() per the
// multi-tenancy rule. ActivityLog rows land under SYSTEM_ORG_ID.
//
// Every toggle flip is logged — turning the machine on is an audited act.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  AUTOMATION_MAX_COUNT_PER_RUN,
  type AutomationParams,
  type ReviewSection,
} from "@elc/ai";
import {
  Prisma,
  SYSTEM_ORG_ID,
  isValidTimeZone,
  localDateTimeToUtc,
  withSuperAdminContext,
} from "@elc/db";
import { requireRole } from "@/lib/auth/context";
import {
  executeAutomationRun,
} from "@/lib/automation/runner";
import {
  AUTOMATION_SETTINGS_ID,
  getAutomationSettings,
} from "@/lib/automation/settings";

const AUTOMATION_PATH = "/content/automation";

// A 10-test Listening batch would blow the cron function's time budget on
// TTS synth alone — cap Listening tighter than the global per-run cap.
const LISTENING_MAX_COUNT = 3;

const SECTIONS = ["Reading", "Listening", "Writing", "Speaking"] as const;
type DbSection = (typeof SECTIONS)[number];

const SECTION_TO_REVIEW: Record<DbSection, ReviewSection> = {
  Reading: "reading",
  Listening: "listening",
  Writing: "writing",
  Speaking: "speaking",
};

const WRITING_TASK_KINDS = [
  "writing-task-1-academic",
  "writing-task-1-general",
  "writing-task-2",
] as const;

function fail(code: string): never {
  redirect(`${AUTOMATION_PATH}?schedule_error=${encodeURIComponent(code)}`);
}

function str(formData: FormData, key: string): string | undefined {
  const raw = formData.get(key);
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function int(formData: FormData, key: string): number | undefined {
  const raw = str(formData, key);
  if (raw === undefined) return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) ? n : undefined;
}

// ─── Kill switches ────────────────────────────────────────────────────────

export async function setAutomationToggle(formData: FormData): Promise<void> {
  const ctx = await requireRole("SuperAdmin");
  const db = withSuperAdminContext(ctx);

  const toggle = str(formData, "toggle");
  const value = str(formData, "value");
  if (
    (toggle !== "generation" && toggle !== "auto_publish") ||
    (value !== "on" && value !== "off")
  ) {
    throw new Error("Invalid toggle request.");
  }
  const enabled = value === "on";
  const data =
    toggle === "generation"
      ? { generation_enabled: enabled }
      : { auto_publish_enabled: enabled };

  await db.automationSettings.upsert({
    where: { id: AUTOMATION_SETTINGS_ID },
    update: { ...data, updated_by: ctx.user_id },
    create: {
      id: AUTOMATION_SETTINGS_ID,
      ...data,
      updated_by: ctx.user_id,
    },
  });
  await db.activityLog.create({
    data: {
      org_id: SYSTEM_ORG_ID,
      user_id: ctx.user_id,
      action: `content.automation.${toggle === "generation" ? "generation" : "publish"}_${enabled ? "enabled" : "disabled"}`,
      metadata: {} as Prisma.InputJsonValue,
    },
  });

  revalidatePath(AUTOMATION_PATH);
  redirect(`${AUTOMATION_PATH}?settings=updated`);
}

// ─── Schedule CRUD ────────────────────────────────────────────────────────

export async function createGenerationSchedule(
  formData: FormData,
): Promise<void> {
  const ctx = await requireRole("SuperAdmin");
  const db = withSuperAdminContext(ctx);

  const sectionRaw = str(formData, "section");
  const section = SECTIONS.includes(sectionRaw as DbSection)
    ? (sectionRaw as DbSection)
    : undefined;
  if (!section) fail("section");

  const trackRaw = str(formData, "track");
  const track =
    trackRaw === "Academic" || trackRaw === "GeneralTraining"
      ? trackRaw
      : undefined;
  if (!track) fail("track");

  const difficulty = int(formData, "difficulty");
  if (difficulty === undefined || difficulty < 1 || difficulty > 5) {
    fail("difficulty");
  }

  const maxCount =
    section === "Listening" ? LISTENING_MAX_COUNT : AUTOMATION_MAX_COUNT_PER_RUN;
  const count = int(formData, "count");
  if (count === undefined || count < 1 || count > maxCount) fail("count");

  // Academic Reading only: optional IELTS part.
  const partRaw = int(formData, "part");
  const part =
    section === "Reading" &&
    track === "Academic" &&
    (partRaw === 1 || partRaw === 2 || partRaw === 3)
      ? partRaw
      : null;

  // Writing only: task kind is required.
  let taskKind: string | null = null;
  if (section === "Writing") {
    const raw = str(formData, "task_kind");
    if (!WRITING_TASK_KINDS.includes(raw as (typeof WRITING_TASK_KINDS)[number])) {
      fail("task_kind");
    }
    taskKind = raw as string;
    // Task 1 kinds imply their track — keep the row self-consistent.
    if (taskKind === "writing-task-1-academic" && track !== "Academic") fail("task_kind_track");
    if (taskKind === "writing-task-1-general" && track !== "GeneralTraining") fail("task_kind_track");
  }

  const topicHint = str(formData, "topic_hint")?.slice(0, 300) ?? null;

  const timezone = str(formData, "timezone") ?? "Australia/Sydney";
  if (!isValidTimeZone(timezone)) fail("timezone");

  const mode = str(formData, "mode");
  if (mode !== "OneOff" && mode !== "Recurring") fail("mode");

  let runAt: Date | null = null;
  let frequency: "Daily" | "Weekly" | null = null;
  let weekday: number | null = null;
  let runHour: number | null = null;

  if (mode === "OneOff") {
    const dateRaw = str(formData, "run_date"); // YYYY-MM-DD from <input type="date">
    const timeRaw = str(formData, "run_time") ?? "09:00"; // HH:MM
    const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateRaw ?? "");
    const timeMatch = /^(\d{2}):(\d{2})$/.exec(timeRaw);
    if (!dateMatch || !timeMatch) fail("run_at");
    runAt = localDateTimeToUtc(
      {
        year: Number(dateMatch[1]),
        month: Number(dateMatch[2]),
        day: Number(dateMatch[3]),
        hour: Number(timeMatch[1]),
        minute: Number(timeMatch[2]),
      },
      timezone,
    );
    // Past instants would fire on the next tick — almost always a typo.
    if (runAt.getTime() < Date.now() - 60_000) fail("run_at_past");
  } else {
    const freqRaw = str(formData, "frequency");
    if (freqRaw !== "Daily" && freqRaw !== "Weekly") fail("frequency");
    frequency = freqRaw;
    runHour = int(formData, "run_hour") ?? null;
    if (runHour === null || runHour < 0 || runHour > 23) fail("run_hour");
    if (frequency === "Weekly") {
      weekday = int(formData, "weekday") ?? null;
      if (weekday === null || weekday < 0 || weekday > 6) fail("weekday");
    }
  }

  await db.generationSchedule.create({
    data: {
      section,
      track,
      difficulty,
      part,
      task_kind: taskKind,
      topic_hint: topicHint,
      count,
      mode,
      timezone,
      run_at: runAt,
      frequency,
      weekday,
      run_hour: runHour,
      created_by: ctx.user_id,
    },
  });
  await db.activityLog.create({
    data: {
      org_id: SYSTEM_ORG_ID,
      user_id: ctx.user_id,
      action: "content.automation.schedule_created",
      metadata: { section, track, difficulty, count, mode } as Prisma.InputJsonValue,
    },
  });

  revalidatePath(AUTOMATION_PATH);
  redirect(`${AUTOMATION_PATH}?schedule=created`);
}

export async function toggleGenerationSchedule(
  formData: FormData,
): Promise<void> {
  const ctx = await requireRole("SuperAdmin");
  const db = withSuperAdminContext(ctx);
  const id = str(formData, "scheduleId");
  const enable = str(formData, "enable") === "1";
  if (!id) throw new Error("Missing scheduleId.");

  await db.generationSchedule.update({
    where: { id },
    data: { enabled: enable },
  });
  await db.activityLog.create({
    data: {
      org_id: SYSTEM_ORG_ID,
      user_id: ctx.user_id,
      action: `content.automation.schedule_${enable ? "enabled" : "disabled"}`,
      metadata: { schedule_id: id } as Prisma.InputJsonValue,
    },
  });
  revalidatePath(AUTOMATION_PATH);
  redirect(AUTOMATION_PATH);
}

export async function deleteGenerationSchedule(
  formData: FormData,
): Promise<void> {
  const ctx = await requireRole("SuperAdmin");
  const db = withSuperAdminContext(ctx);
  const id = str(formData, "scheduleId");
  if (!id) throw new Error("Missing scheduleId.");

  // Runs survive (schedule_id → null) — history is audit data.
  await db.generationSchedule.delete({ where: { id } });
  await db.activityLog.create({
    data: {
      org_id: SYSTEM_ORG_ID,
      user_id: ctx.user_id,
      action: "content.automation.schedule_deleted",
      metadata: { schedule_id: id } as Prisma.InputJsonValue,
    },
  });
  revalidatePath(AUTOMATION_PATH);
  redirect(AUTOMATION_PATH);
}

// ─── Run now ──────────────────────────────────────────────────────────────
//
// Executes a schedule immediately, as the ACTING SuperAdmin (not the
// schedule creator), under the SYSTEM org. Works while scheduled
// automation is paused — this is the rehearsal path. Stamps last_run_at
// (and consumes a OneOff) so the cron doesn't double-run the same batch.

export async function runScheduleNow(formData: FormData): Promise<void> {
  const sessionCtx = await requireRole("SuperAdmin");
  const db = withSuperAdminContext(sessionCtx);
  const id = str(formData, "scheduleId");
  if (!id) throw new Error("Missing scheduleId.");

  const schedule = await db.generationSchedule.findUnique({ where: { id } });
  if (!schedule) throw new Error("Schedule not found.");

  const settings = await getAutomationSettings();
  const params: AutomationParams = {
    section: SECTION_TO_REVIEW[schedule.section],
    track: schedule.track,
    difficulty: schedule.difficulty,
    part:
      schedule.part === 1 || schedule.part === 2 || schedule.part === 3
        ? schedule.part
        : undefined,
    taskKind: schedule.task_kind ?? undefined,
    topicHint: schedule.topic_hint ?? undefined,
  };

  await db.generationSchedule.update({
    where: { id },
    data: {
      last_run_at: new Date(),
      ...(schedule.mode === "OneOff" ? { enabled: false } : {}),
    },
  });

  const run = await executeAutomationRun({
    scheduleId: schedule.id,
    trigger: "Manual",
    params,
    count: schedule.count,
    // Same SuperAdmin identity, but cost/quota attribution moves to the
    // SYSTEM org — automation spend never lands on a customer org or the
    // SuperAdmin's home org.
    ctx: { org_id: SYSTEM_ORG_ID, user_id: sessionCtx.user_id, role: "SuperAdmin" },
    autoPublish: settings.auto_publish_enabled,
  });

  revalidatePath(AUTOMATION_PATH);
  redirect(`${AUTOMATION_PATH}/runs/${run.runId}`);
}
