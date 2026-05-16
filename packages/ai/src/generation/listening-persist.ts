// Persistence for generated Listening content.
//
// The output of `listeningGenerator.generate()` is a typed
// `GeneratedListening` — the full 4-part section script plus the question
// payloads. This module is the bit between the validator and the database:
//
//   - The whole script (the `parts` array) goes to `Test.body_json` as
//     the runtime `ListeningContent` shape that `packages/ai/src/listening/
//     content.ts` will parse back. We tag it `schema_version: 1` so the
//     parser knows which contract to apply.
//   - One `Question` row per generated question. The Phase 1 question
//     types (mcq-single, mcq-multi, sentence-completion, short-answer,
//     completion-blank) write their `correct_answer` payload into the
//     per-row JSON column. `Question.position` is the global slot index.
//   - `audio_clip` is NOT populated here — Phase 2's tts-cache attaches
//     clips at SuperAdmin-approval time, not at generation time. The
//     persisted body_json has speech/narration segments WITHOUT
//     audio_clip fields, which the parser already accepts.
//
// `Test.status` starts as PendingReview; SuperAdmin moderation (Phase 5)
// promotes it to Approved.
//
// Tests inject a `db` mock; production passes the raw PrismaClient
// because Test/Question are global models — `withOrg()` would not scope
// them anyway.

import { Prisma } from "@elc/db";
import type { prisma } from "@elc/db/client";
import type {
  GeneratedListening,
  GeneratedListeningQuestion,
} from "./listening-schema";

// Structural slice of the production PrismaClient.
export type PersistGeneratedListeningDb = Pick<
  typeof prisma,
  "test" | "question"
>;

export type PersistListeningResult = {
  testId: string;
  questionIds: string[];
};

function buildBodyJson(value: GeneratedListening): Prisma.InputJsonValue {
  // The runtime parser (packages/ai/src/listening/content.ts) requires
  // schema_version: 1 + parts[] in part-number order. The generator
  // already enforces ordering at the schema layer; we just stamp the
  // version on the way in.
  return {
    schema_version: 1,
    parts: value.parts,
  } as unknown as Prisma.InputJsonValue;
}

function questionPayloadToJson(
  q: GeneratedListeningQuestion,
): Prisma.InputJsonValue {
  return q.correct_answer as unknown as Prisma.InputJsonValue;
}

// Real IELTS-style points: 1 per correctly-answered question, with
// mcq-multi worth its `pick_count`. The generator already populates
// `points` with a sensible default; we honour it.
function questionPoints(q: GeneratedListeningQuestion): number {
  return q.points;
}

export async function persistGeneratedListening(
  db: PersistGeneratedListeningDb,
  value: GeneratedListening,
  opts: {
    // The SuperAdmin who initiated the generation. Currently logged at
    // the route layer, not here — kept on the input shape so the
    // signature is stable when that wiring lands.
    generatedById: string;
    // Optional override of the difficulty stored on the Test row. The
    // schema also carries `difficulty`, but the caller may want to clamp
    // (the model occasionally returns the wrong number).
    difficulty?: number;
  },
): Promise<PersistListeningResult> {
  void opts.generatedById; // logged at the route layer, not here

  const test = await db.test.create({
    data: {
      track: value.track,
      section: "Listening",
      difficulty: opts.difficulty ?? value.difficulty,
      // PendingReview rows have no approver until moderation promotes them.
      status: "PendingReview",
      body_json: buildBodyJson(value),
    },
    select: { id: true },
  });

  // Persist questions sequentially. Sequential not because of any cross-
  // row dependency, but because a parallel Promise.all would burn a
  // connection per question and Listening sections hit 20–32 rows.
  const questionIds: string[] = [];
  for (const q of value.questions) {
    const created = await db.question.create({
      data: {
        test_id: test.id,
        type: q.type,
        prompt: q.prompt,
        position: q.position,
        points: questionPoints(q),
        correct_answer: questionPayloadToJson(q),
        // Listening questions never use the visual column.
        visual: Prisma.JsonNull,
      },
      select: { id: true },
    });
    questionIds.push(created.id);
  }

  return { testId: test.id, questionIds };
}
