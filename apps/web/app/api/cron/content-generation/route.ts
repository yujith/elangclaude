// GET /api/cron/content-generation — scheduled content automation (ADR-0024).
//
// Runs hourly (see vercel.json). For every due GenerationSchedule it
// executes the generate → review → publish loop via the automation runner.
//
// Auth: the shared CRON_SECRET bearer token, exactly like /api/cron/retention.
//
// Trust model: this is a SYSTEM job — schedule scanning and claiming use
// the raw prisma client (no session exists). The runner itself executes
// as the schedule's creator (verified to still be a live SuperAdmin)
// under SYSTEM_ORG_ID, so every AI call is quota-gated and cost-logged
// against the system org, never a customer org.
//
// Concurrency: each due schedule is CLAIMED with an optimistic
// updateMany guard on last_run_at before any work happens — an
// overlapping invocation (manual curl + cron tick) loses the claim and
// skips. One-off schedules are disabled in the same claim write.
//
// Budget guards: at most MAX_SCHEDULES_PER_TICK schedules per tick (a
// Listening batch with TTS synth is slow; the due-check's same-local-day
// catch-up picks the rest up next hour), plus the per-run count cap and
// the system org's quota_daily inside the runner.

import { NextResponse } from "next/server";
import { isScheduleDue } from "@elc/db";
import { prisma } from "@elc/db/client";
import type { AutomationParams, ReviewSection } from "@elc/ai";
import {
  executeAutomationRun,
  resolveActingSuperAdmin,
} from "@/lib/automation/runner";
import { getAutomationSettings } from "@/lib/automation/settings";

export const dynamic = "force-dynamic";
// A run with reviews (and Listening TTS) is slow; give it headroom.
export const maxDuration = 300;

const MAX_SCHEDULES_PER_TICK = 2;

const SECTION_TO_REVIEW: Record<string, ReviewSection> = {
  Reading: "reading",
  Listening: "listening",
  Writing: "writing",
  Speaking: "speaking",
};

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization");
  return header === `Bearer ${secret}`;
}

function parsePart(raw: number | null): 1 | 2 | 3 | undefined {
  if (raw === 1 || raw === 2 || raw === 3) return raw;
  return undefined;
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const settings = await getAutomationSettings();
  if (!settings.generation_enabled) {
    return NextResponse.json({
      ok: true,
      skipped: "automation_disabled",
      ran_at: new Date().toISOString(),
    });
  }

  const now = new Date();
  const schedules = await prisma.generationSchedule.findMany({
    where: { enabled: true },
  });
  const due = schedules
    .filter((s) => isScheduleDue(s, now))
    .slice(0, MAX_SCHEDULES_PER_TICK);

  const results: unknown[] = [];
  for (const s of due) {
    // Claim before any work. The last_run_at guard makes the write
    // first-wins: a concurrent invocation that read the same snapshot
    // matches 0 rows and skips.
    const claimed = await prisma.generationSchedule.updateMany({
      where: { id: s.id, last_run_at: s.last_run_at },
      data: {
        last_run_at: now,
        ...(s.mode === "OneOff" ? { enabled: false } : {}),
      },
    });
    if (claimed.count !== 1) {
      results.push({ schedule_id: s.id, skipped: "claimed_elsewhere" });
      continue;
    }

    const ctx = await resolveActingSuperAdmin(s.created_by);
    if (!ctx) {
      // Record the failure so it is visible in run history rather than
      // silently swallowed by the cron log.
      await prisma.generationRun.create({
        data: {
          schedule_id: s.id,
          trigger: "Scheduled",
          status: "Failed",
          section: s.section,
          track: s.track,
          difficulty: s.difficulty,
          requested_count: s.count,
          auto_publish: settings.auto_publish_enabled,
          error: "schedule creator is not a live SuperAdmin",
          finished_at: new Date(),
          created_by: s.created_by,
        },
      });
      results.push({ schedule_id: s.id, error: "creator_missing" });
      continue;
    }

    const section = SECTION_TO_REVIEW[s.section];
    if (!section) {
      results.push({ schedule_id: s.id, error: "unknown_section" });
      continue;
    }
    const params: AutomationParams = {
      section,
      track: s.track,
      difficulty: s.difficulty,
      part: parsePart(s.part),
      taskKind: s.task_kind ?? undefined,
      topicHint: s.topic_hint ?? undefined,
    };

    const run = await executeAutomationRun({
      scheduleId: s.id,
      trigger: "Scheduled",
      params,
      count: s.count,
      ctx,
      autoPublish: settings.auto_publish_enabled,
    });
    results.push({ schedule_id: s.id, ...run });
  }

  return NextResponse.json({
    ok: true,
    ran_at: now.toISOString(),
    due_count: due.length,
    results,
  });
}
