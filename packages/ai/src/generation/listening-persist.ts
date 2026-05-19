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

// ─── IELTS-style boilerplate narration ──────────────────────────────────
//
// Real IELTS Listening opens with a test-level instruction from the
// narrator and closes with a "ten minutes to transfer" cue. We inject
// the same text into every persisted Test so the audio flow matches the
// real exam. The TTS cache (keyed on text+voice+model) means the bytes
// are synthesised exactly once across all Tests; every subsequent
// approval is a cache hit.
//
// We mark our injected speaker with a stable id + explicit voice_id so
// the voice catalogue picker always returns the same George (British
// male, narration) voice — that's what keeps the cache hot.

const IELTS_NARRATOR_SPEAKER = {
  id: "__ielts_boilerplate_narrator__",
  name: "IELTS Narrator",
  role: "narrator" as const,
  accent: "british" as const,
  // NOTE: deliberately NOT pinning a voice_id here. Earlier versions
  // pinned to George (JBFqnCBsd6RMkjVDRZzb) for maximum cache reuse,
  // but if that specific ElevenLabs voice id isn't in the operator's
  // account, ONLY the boilerplate clips fail synth — every other
  // narration in the section still works (because the picker hashes
  // (testId, speaker.id) across the catalogue and lands on a valid
  // voice 2 of 3 times). Letting the catalogue picker resolve the
  // voice means the boilerplate succeeds whenever the per-part
  // narration succeeds. We lose a sliver of cross-Test dedup; we
  // gain a much more reliable opening + closing clip.
};

// The opening/closing strings live in their own client-safe module so the
// player bundle can import them without pulling node:fs in transitively.
// Re-exported here for back-compat with existing server callers.
export { OPENING_NARRATION, CLOSING_NARRATION } from "../listening/boilerplate";
import { OPENING_NARRATION, CLOSING_NARRATION } from "../listening/boilerplate";

type RawPart = GeneratedListening["parts"][number];
type RawSpeaker = RawPart["speakers"][number];
type RawSegment = RawPart["transcript"][number];

function withBoilerplateSpeaker(speakers: readonly RawSpeaker[]): RawSpeaker[] {
  if (speakers.some((s) => s.id === IELTS_NARRATOR_SPEAKER.id)) {
    return [...speakers];
  }
  return [IELTS_NARRATOR_SPEAKER, ...speakers];
}

function injectOpening(part: RawPart): RawPart {
  // Idempotent — if Part 1 already starts with our injected narration
  // (re-persist of the same value), don't double up.
  const first = part.transcript[0];
  if (
    first &&
    first.kind === "narration" &&
    first.text === OPENING_NARRATION
  ) {
    return part;
  }
  const openingSegment: RawSegment = {
    kind: "narration",
    text: OPENING_NARRATION,
  };
  return {
    ...part,
    speakers: withBoilerplateSpeaker(part.speakers),
    transcript: [openingSegment, ...part.transcript],
  };
}

function injectClosing(part: RawPart): RawPart {
  const last = part.transcript[part.transcript.length - 1];
  if (
    last &&
    last.kind === "narration" &&
    last.text === CLOSING_NARRATION
  ) {
    return part;
  }
  const closingSegment: RawSegment = {
    kind: "narration",
    text: CLOSING_NARRATION,
  };
  return {
    ...part,
    speakers: withBoilerplateSpeaker(part.speakers),
    transcript: [...part.transcript, closingSegment],
  };
}

// Pre-process the generated parts so Part 1 carries the test-level
// opening narration and Part 4 carries the test-level closing. Both
// go through the normal TTS pipeline on approval — no special-case
// player handling required.
function injectBoilerplate(
  parts: readonly RawPart[],
): GeneratedListening["parts"] {
  const out = [...parts] as GeneratedListening["parts"];
  if (out.length > 0) {
    out[0] = injectOpening(out[0]!);
  }
  if (out.length >= 4) {
    out[3] = injectClosing(out[3]!);
  } else if (out.length > 0) {
    // Schema enforces length===4 in practice. Defensive: if a future
    // generation has fewer parts, append the closing to the last one.
    out[out.length - 1] = injectClosing(out[out.length - 1]!);
  }
  return out;
}

function buildBodyJson(value: GeneratedListening): Prisma.InputJsonValue {
  // The runtime parser (packages/ai/src/listening/content.ts) requires
  // schema_version: 1 + parts[] in part-number order. The generator
  // already enforces ordering at the schema layer; we just stamp the
  // version on the way in.
  return {
    schema_version: 1,
    parts: injectBoilerplate(value.parts),
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
