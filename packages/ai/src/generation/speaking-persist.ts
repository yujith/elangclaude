// Persistence for generated Speaking content.
//
// The output of `speakingGenerator.generate()` is a typed `GeneratedSpeaking`
// — the full 3-part examiner script. This module is the bit between the
// validator and the database (see docs/adr/0006-speaking-data-shape.md):
//
//   - The whole script goes to `Test.body_json` (the canonical source the
//     Phase 2 realtime examiner reads).
//   - Exactly 3 thin `Question` rows are created — one per IELTS part — as
//     anchors the Phase 3 transcript pipeline hangs `Answer` rows on. They
//     carry a short readable label and no `correct_answer` / `visual`.
//
// `Test.status` starts as PendingReview; SuperAdmin moderation promotes it.
//
// Tests inject a `db` mock; production passes the raw PrismaClient because
// Test/Question are global models — `withOrg()` would not scope them anyway.

import { Prisma } from "@elc/db";
import type { prisma } from "@elc/db/client";
import type { GeneratedSpeaking } from "./speaking-schema";

// Structural slice of the production PrismaClient.
export type PersistGeneratedSpeakingDb = Pick<
  typeof prisma,
  "test" | "question"
>;

export type PersistSpeakingResult = {
  testId: string;
  questionIds: string[];
};

// The 3 part anchors, in display order. `type` strings are the contract the
// Phase 2 runner + Phase 3 transcript pipeline key on.
const PART_TYPES = [
  "speaking-part-1",
  "speaking-part-2-cue",
  "speaking-part-3",
] as const;

// body_json holds the whole script minus the columns already on the Test row
// (section / track / difficulty live in real columns).
function buildBodyJson(value: GeneratedSpeaking): Prisma.InputJsonValue {
  return {
    topic_domain: value.topic_domain,
    part1: value.part1,
    part2: value.part2,
    part3: value.part3,
  } as unknown as Prisma.InputJsonValue;
}

// Short human-readable labels for the thin Question rows — what the
// moderation queue and (as a fallback) the runner show.
function partPrompts(value: GeneratedSpeaking): [string, string, string] {
  return [
    `Speaking Part 1 — Interview: ${value.part1.theme}`,
    `Speaking Part 2 — Long turn: ${value.part2.cue_card_topic}`,
    `Speaking Part 3 — Discussion: ${value.part3.theme}`,
  ];
}

export async function persistGeneratedSpeaking(
  db: PersistGeneratedSpeakingDb,
  value: GeneratedSpeaking,
  opts: {
    // The SuperAdmin who initiated the generation. Logged to ActivityLog at
    // the route layer, not here — kept on the input shape so the signature
    // is stable when that wiring lands.
    generatedById: string;
    // Optional override of the difficulty stored on the Test row.
    difficulty?: number;
    // The model that generated this content (gateway ChatResponse.model).
    // Stored on Test.generated_model so moderation can see provenance.
    generatedModel?: string;
  },
): Promise<PersistSpeakingResult> {
  void opts.generatedById; // logged at the route layer, not here

  const test = await db.test.create({
    data: {
      track: value.track,
      section: "Speaking",
      difficulty: opts.difficulty ?? value.difficulty,
      // PendingReview rows have no approver until moderation promotes them.
      status: "PendingReview",
      body_json: buildBodyJson(value),
      generated_model: opts.generatedModel ?? null,
    },
    select: { id: true },
  });

  const prompts = partPrompts(value);
  const questionIds: string[] = [];
  for (let position = 0; position < PART_TYPES.length; position++) {
    const question = await db.question.create({
      data: {
        test_id: test.id,
        type: PART_TYPES[position]!,
        prompt: prompts[position]!,
        position,
        // Speaking is rubric-graded from the conversation — no answer key,
        // no visual. The structured content lives on Test.body_json.
        correct_answer: Prisma.JsonNull,
        visual: Prisma.JsonNull,
      },
      select: { id: true },
    });
    questionIds.push(question.id);
  }

  return { testId: test.id, questionIds };
}
