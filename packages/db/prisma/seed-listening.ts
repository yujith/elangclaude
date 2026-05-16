// Opt-in seed: generate + approve a batch of live Listening sections.
//
// Hits ElevenLabs + OpenRouter (cost: ~$1-2 per section). Not wired into
// `prisma db seed` — must be run explicitly with the project script:
//
//   pnpm --filter @elc/db seed:listening
//
// Or with overrides:
//
//   pnpm --filter @elc/db seed:listening -- --count=3 --track=GeneralTraining
//
// Required env (read from packages/db/.env via dotenv at the @elc/ai
// boundary): OPENROUTER_API_KEY, ELEVENLABS_API_KEY, CLOUDFLARE_R2_*.
//
// Idempotent only in the trivial sense: re-running creates MORE Tests
// rather than re-using existing ones. The TTS cache layer dedupes
// per-segment synth even across runs, so re-running is cheap if the
// generation outputs share narration boilerplate.

import {
  attachSynthesizedClips,
  listeningGenerator,
  parseListeningContent,
  persistGeneratedListening,
  planSynthesisJobs,
  ttsCache,
  type SynthesizedClip,
} from "@elc/ai";
import { Prisma, PrismaClient, type Track } from "@prisma/client";

const prisma = new PrismaClient();

type Args = {
  count: number;
  track: Track;
  difficulties: number[];
  topicHints: string[];
};

function parseArgs(argv: string[]): Args {
  let count = 3;
  let track: Track = "Academic";
  for (const arg of argv) {
    const m = /^--([a-z-]+)=(.+)$/.exec(arg);
    if (!m) continue;
    const [, key, value] = m;
    if (key === "count") {
      const n = Number.parseInt(value!, 10);
      if (Number.isInteger(n) && n > 0 && n <= 20) count = n;
    } else if (key === "track") {
      if (value === "Academic" || value === "GeneralTraining") track = value;
    }
  }
  // Sensible per-difficulty rotation + topic hints — covers band 5-8 targets.
  const difficulties = [2, 3, 4, 3, 4, 5].slice(0, count);
  const topicHints = [
    "library card registration and membership tiers",
    "community garden tour with volunteer roles",
    "marine biology dissertation tutorial",
    "history of mechanical clockmaking",
    "city transport survey results",
    "campus accommodation registration",
  ].slice(0, count);
  return { count, track, difficulties, topicHints };
}

async function findOrCreateSuperAdminCtx(): Promise<{
  org_id: string;
  user_id: string;
  role: "SuperAdmin";
}> {
  const existing = await prisma.user.findFirst({
    where: { role: "SuperAdmin" },
    select: { id: true, org_id: true },
  });
  if (existing) {
    return {
      org_id: existing.org_id,
      user_id: existing.id,
      role: "SuperAdmin",
    };
  }
  // Fall back to the canonical seed SuperAdmin from prisma/seed.ts. If
  // it doesn't exist either, fail loudly — the caller should run
  // `pnpm db:seed` first.
  throw new Error(
    "No SuperAdmin user found. Run `pnpm db:seed` first to create the canonical seed accounts.",
  );
}

async function generateOne(
  ctx: { org_id: string; user_id: string; role: "SuperAdmin" },
  track: Track,
  difficulty: number,
  topicHint: string,
): Promise<{ testId: string; synthed: number; failed: number }> {
  console.log(
    `\n→ generating Listening (${track}, difficulty ${difficulty}, hint="${topicHint}")…`,
  );
  const result = await listeningGenerator.generate({
    ctx,
    track,
    difficulty,
    topicHint,
  });
  console.log(
    `  model=${result.model} attempts=${result.attempts} questions=${result.value.questions.length}`,
  );

  const persisted = await persistGeneratedListening(prisma, result.value, {
    generatedById: ctx.user_id,
    difficulty,
  });
  console.log(
    `  persisted as PendingReview test=${persisted.testId} (${persisted.questionIds.length} question rows)`,
  );

  // Re-read body_json + run the synth orchestration. Mirrors the
  // apps/web moderation action but doesn't need Next.js context.
  const fresh = await prisma.test.findUniqueOrThrow({
    where: { id: persisted.testId },
    select: { body_json: true },
  });
  const content = parseListeningContent(fresh.body_json);
  if (!content) {
    throw new Error("Generated content failed re-parse — should not happen.");
  }

  const jobs = planSynthesisJobs(content, persisted.testId);
  console.log(
    `  TTS: ${jobs.length} synth jobs planned. Running… (this is the slow bit)`,
  );

  const clips: SynthesizedClip[] = [];
  let synthed = 0;
  let failed = 0;
  for (let i = 0; i < jobs.length; i += 1) {
    const job = jobs[i]!;
    try {
      const res = await ttsCache.synthesizeAndCache({
        ctx,
        text: job.text,
        voice_id: job.voice_id,
        format: job.format,
      });
      synthed += 1;
      clips.push({
        part_index: job.part_index,
        segment_index: job.segment_index,
        clip: {
          storage_key: res.storage_key,
          duration_sec: res.duration_sec,
          sha256: res.sha256,
          format: res.format,
        },
      });
      process.stdout.write(
        `\r  TTS: ${i + 1}/${jobs.length} done (${res.cache})…       `,
      );
    } catch (err) {
      failed += 1;
      console.error(`\n  ! synth failed for job ${i}: ${(err as Error).message}`);
    }
  }
  process.stdout.write("\n");

  if (clips.length > 0) {
    const next = attachSynthesizedClips(content, clips);
    await prisma.test.update({
      where: { id: persisted.testId },
      data: { body_json: next as unknown as Prisma.InputJsonValue },
    });
  }

  // Approve so learners can see it. Tag approved_by with the seed
  // SuperAdmin so the moderation log shows who released the content.
  await prisma.test.update({
    where: { id: persisted.testId },
    data: { status: "Approved", approved_by: ctx.user_id },
  });

  console.log(
    `  ✓ approved · clips: ${synthed} synthed (${failed} failed). Visible to ${track} learners.`,
  );
  return { testId: persisted.testId, synthed, failed };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(
    `seed-listening: track=${args.track} count=${args.count}`,
  );

  const ctx = await findOrCreateSuperAdminCtx();
  console.log(`Using SuperAdmin user_id=${ctx.user_id} org_id=${ctx.org_id}`);

  let totalSynthed = 0;
  let totalFailed = 0;
  const newTestIds: string[] = [];
  for (let i = 0; i < args.count; i += 1) {
    const difficulty = args.difficulties[i] ?? 3;
    const topicHint = args.topicHints[i] ?? "";
    const res = await generateOne(ctx, args.track, difficulty, topicHint);
    newTestIds.push(res.testId);
    totalSynthed += res.synthed;
    totalFailed += res.failed;
  }

  console.log(
    `\n=== done. ${args.count} sections approved. ${totalSynthed} clips synthesised, ${totalFailed} failed.`,
  );
  if (totalFailed > 0) {
    console.log(
      `Re-run via the SuperAdmin moderation page to retry failed clips:`,
    );
    for (const id of newTestIds) {
      console.log(`  /content/listening/${id}`);
    }
  }
}

main()
  .catch((err) => {
    console.error("\nseed-listening failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
