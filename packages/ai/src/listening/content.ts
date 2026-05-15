// Listening body_json payload parser.
//
// One Listening Test = the full 4-part section. The DB stores the script on
// Test.body_json as arbitrary JSON; this module owns the shape and the
// parser. A malformed row returns `null`; the runner refuses to start the
// attempt rather than render half-broken UI.
//
// See docs/adr/0007-listening-data-shape.md for the decisions behind the
// shape. The structure parallels Speaking (ADR 0006 D1) — one cohesive
// timed script on body_json with thin Question rows hanging off — while
// reusing the per-section CompletionBlock pattern Reading introduced
// (ADR 0003 D1, packages/ai/src/reading/passage.ts).

// ─── Speaker / segment primitives ───────────────────────────────────────

export type ListeningAccent =
  | "british"
  | "american"
  | "australian"
  | "canadian"
  | "new-zealand";

export type ListeningSpeakerRole = "narrator" | "examiner" | "speaker";

export type ListeningSpeaker = {
  // Stable, unique within its parent ListeningPart. Speech segments inside
  // the part reference this id. Speaker ids do NOT have to be unique across
  // parts — Part 1's "Tom" is not the same entity as Part 3's "Tom".
  id: string;
  name: string;
  role: ListeningSpeakerRole;
  accent: ListeningAccent;
  // Optional ElevenLabs (or other TTS provider) voice id. Phase 2 fills this
  // at synth time; Phase 1 fixtures leave it undefined.
  voice_id?: string;
};

export type ListeningSegment =
  | { kind: "narration"; text: string }
  | { kind: "speech"; speaker_id: string; text: string }
  | { kind: "reading-pause"; seconds: number; instruction?: string }
  | { kind: "questions-preview"; seconds: number; question_positions: number[] };

// ─── Audio asset ────────────────────────────────────────────────────────
//
// The audio asset is the synthesised recording for a whole part. Phase 1
// fixtures and freshly-generated tests leave it undefined; Phase 2 populates
// it at SuperAdmin-approval time. The storage_key is GLOBAL ("audio/{sha256}
// .{ext}") — see ADR 0007 D5.

export type ListeningAudioFormat = "mp3" | "wav" | "ogg";

export type ListeningAudioAsset = {
  storage_key: string;
  duration_sec: number;
  sha256: string; // lowercase hex, 64 chars
  format: ListeningAudioFormat;
};

// ─── Completion blocks (form / notes / table / flow-chart / summary / diagram) ─

export type ListeningCompletionLayout =
  | "form"
  | "notes"
  | "table"
  | "flow-chart"
  | "summary"
  | "diagram";

export type ListeningSegmentCell =
  | { kind: "text"; text: string }
  | { kind: "blank"; slot_id: string };

export type ListeningCompletionRow = {
  // Optional leading label — e.g. the field name on a form ("Name:"), the
  // step number on a flow-chart, the callout label on a diagram. Renderer
  // decides per layout.
  label?: string;
  // Table-only: when true the row renders in <thead> and must not contain
  // blank segments. Ignored on other layouts.
  is_header?: boolean;
  // Always an array of cells; non-table layouts conventionally use a single
  // cell whose segments render inline.
  cells: ListeningSegmentCell[][];
};

export type ListeningCompletionBlock = {
  id: string;
  layout: ListeningCompletionLayout;
  title?: string;
  // Optional instruction line ("Write NO MORE THAN TWO WORDS for each
  // answer."). Surfaced once per block by the renderer.
  instructions?: string;
  rows: ListeningCompletionRow[];
};

// ─── Part + content ─────────────────────────────────────────────────────

export type ListeningPartNumber = 1 | 2 | 3 | 4;
export type ListeningPartContext = "social" | "academic";

export type ListeningPart = {
  part: ListeningPartNumber;
  context: ListeningPartContext;
  title: string;
  speakers: ListeningSpeaker[];
  transcript: ListeningSegment[];
  // Question.position values that belong to this part. The runner uses this
  // to group questions for the reading-ahead preview and answer-checking
  // pauses. Globally unique across parts.
  question_positions: number[];
  completion_blocks?: ListeningCompletionBlock[];
  audio_asset?: ListeningAudioAsset;
};

export type ListeningContent = {
  schema_version: 1;
  parts: ListeningPart[]; // length 4, ordered 1..4
};

// ─── Validation primitives ──────────────────────────────────────────────

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function stringOrUndef(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function isPositiveInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v > 0;
}

function isNonNegativeInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

const ACCENTS: ReadonlySet<ListeningAccent> = new Set<ListeningAccent>([
  "british",
  "american",
  "australian",
  "canadian",
  "new-zealand",
]);

const SPEAKER_ROLES: ReadonlySet<ListeningSpeakerRole> =
  new Set<ListeningSpeakerRole>(["narrator", "examiner", "speaker"]);

const AUDIO_FORMATS: ReadonlySet<ListeningAudioFormat> =
  new Set<ListeningAudioFormat>(["mp3", "wav", "ogg"]);

const COMPLETION_LAYOUTS: ReadonlySet<ListeningCompletionLayout> =
  new Set<ListeningCompletionLayout>([
    "form",
    "notes",
    "table",
    "flow-chart",
    "summary",
    "diagram",
  ]);

const PART_CONTEXTS: ReadonlySet<ListeningPartContext> =
  new Set<ListeningPartContext>(["social", "academic"]);

const SHA256_HEX = /^[0-9a-f]{64}$/;

// ─── Speaker / segment parsers ──────────────────────────────────────────

function parseSpeaker(raw: unknown): ListeningSpeaker | null {
  if (!isObject(raw)) return null;
  if (typeof raw.id !== "string" || raw.id.length === 0) return null;
  if (typeof raw.name !== "string" || raw.name.length === 0) return null;
  if (typeof raw.role !== "string") return null;
  if (!SPEAKER_ROLES.has(raw.role as ListeningSpeakerRole)) return null;
  if (typeof raw.accent !== "string") return null;
  if (!ACCENTS.has(raw.accent as ListeningAccent)) return null;
  return {
    id: raw.id,
    name: raw.name,
    role: raw.role as ListeningSpeakerRole,
    accent: raw.accent as ListeningAccent,
    voice_id: stringOrUndef(raw.voice_id),
  };
}

function parseSpeakers(raw: unknown): ListeningSpeaker[] | null {
  if (!Array.isArray(raw)) return null;
  if (raw.length === 0) return null;
  const seen = new Set<string>();
  const out: ListeningSpeaker[] = [];
  for (const s of raw) {
    const sp = parseSpeaker(s);
    if (!sp) return null;
    if (seen.has(sp.id)) return null;
    seen.add(sp.id);
    out.push(sp);
  }
  return out;
}

function parseNumberArray(raw: unknown): number[] | null {
  if (!Array.isArray(raw)) return null;
  const out: number[] = [];
  for (const n of raw) {
    if (!isNonNegativeInt(n)) return null;
    out.push(n);
  }
  return out;
}

function parseSegment(
  raw: unknown,
  speakerIds: ReadonlySet<string>,
  partQuestionPositions: ReadonlySet<number>,
): ListeningSegment | null {
  if (!isObject(raw)) return null;
  if (raw.kind === "narration") {
    if (typeof raw.text !== "string" || raw.text.length === 0) return null;
    return { kind: "narration", text: raw.text };
  }
  if (raw.kind === "speech") {
    if (typeof raw.speaker_id !== "string" || raw.speaker_id.length === 0) {
      return null;
    }
    if (!speakerIds.has(raw.speaker_id)) return null;
    if (typeof raw.text !== "string" || raw.text.length === 0) return null;
    return { kind: "speech", speaker_id: raw.speaker_id, text: raw.text };
  }
  if (raw.kind === "reading-pause") {
    if (!isPositiveInt(raw.seconds)) return null;
    return {
      kind: "reading-pause",
      seconds: raw.seconds,
      instruction: stringOrUndef(raw.instruction),
    };
  }
  if (raw.kind === "questions-preview") {
    if (!isPositiveInt(raw.seconds)) return null;
    const positions = parseNumberArray(raw.question_positions);
    if (!positions || positions.length === 0) return null;
    // Every previewed position must belong to the enclosing part — a preview
    // pointing at a question that isn't in this part is a content bug.
    for (const p of positions) {
      if (!partQuestionPositions.has(p)) return null;
    }
    return {
      kind: "questions-preview",
      seconds: raw.seconds,
      question_positions: positions,
    };
  }
  return null;
}

function parseTranscript(
  raw: unknown,
  speakerIds: ReadonlySet<string>,
  partQuestionPositions: ReadonlySet<number>,
): ListeningSegment[] | null {
  if (!Array.isArray(raw)) return null;
  if (raw.length === 0) return null;
  const out: ListeningSegment[] = [];
  for (const s of raw) {
    const seg = parseSegment(s, speakerIds, partQuestionPositions);
    if (!seg) return null;
    out.push(seg);
  }
  return out;
}

// ─── Completion blocks ──────────────────────────────────────────────────

function parseCell(raw: unknown): ListeningSegmentCell | null {
  if (!isObject(raw)) return null;
  if (raw.kind === "text") {
    if (typeof raw.text !== "string" || raw.text.length === 0) return null;
    return { kind: "text", text: raw.text };
  }
  if (raw.kind === "blank") {
    if (typeof raw.slot_id !== "string" || raw.slot_id.length === 0) return null;
    return { kind: "blank", slot_id: raw.slot_id };
  }
  return null;
}

function parseCellSegments(raw: unknown): ListeningSegmentCell[] | null {
  if (!Array.isArray(raw)) return null;
  const out: ListeningSegmentCell[] = [];
  for (const s of raw) {
    const cell = parseCell(s);
    if (!cell) return null;
    out.push(cell);
  }
  return out;
}

function parseCompletionRow(raw: unknown): ListeningCompletionRow | null {
  if (!isObject(raw)) return null;
  if (!Array.isArray(raw.cells)) return null;
  const cells: ListeningSegmentCell[][] = [];
  for (const c of raw.cells) {
    const segs = parseCellSegments(c);
    if (!segs) return null;
    cells.push(segs);
  }
  if (cells.length === 0) return null;
  return {
    label: stringOrUndef(raw.label),
    is_header: typeof raw.is_header === "boolean" ? raw.is_header : undefined,
    cells,
  };
}

function parseCompletionBlocks(
  raw: unknown,
  globalSlotIds: Set<string>,
): ListeningCompletionBlock[] | null {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) return null;
  const seenBlockIds = new Set<string>();
  const out: ListeningCompletionBlock[] = [];
  for (const b of raw) {
    if (!isObject(b)) return null;
    if (typeof b.id !== "string" || b.id.length === 0) return null;
    if (seenBlockIds.has(b.id)) return null;
    if (typeof b.layout !== "string") return null;
    if (!COMPLETION_LAYOUTS.has(b.layout as ListeningCompletionLayout)) {
      return null;
    }
    if (!Array.isArray(b.rows)) return null;
    const rows: ListeningCompletionRow[] = [];
    for (const r of b.rows) {
      const row = parseCompletionRow(r);
      if (!row) return null;
      if (row.is_header) {
        for (const cell of row.cells) {
          if (cell.some((s) => s.kind === "blank")) return null;
        }
      }
      // Slot ids are unique across ALL completion blocks on the whole
      // ListeningContent (passed in by the caller). Questions reference
      // (block_id, slot_id) so the slot space must not collide.
      for (const cell of row.cells) {
        for (const seg of cell) {
          if (seg.kind === "blank") {
            if (globalSlotIds.has(seg.slot_id)) return null;
            globalSlotIds.add(seg.slot_id);
          }
        }
      }
      rows.push(row);
    }
    if (rows.length === 0) return null;
    seenBlockIds.add(b.id);
    out.push({
      id: b.id,
      layout: b.layout as ListeningCompletionLayout,
      title: stringOrUndef(b.title),
      instructions: stringOrUndef(b.instructions),
      rows,
    });
  }
  return out;
}

// ─── Audio asset ────────────────────────────────────────────────────────

function parseAudioAsset(raw: unknown): ListeningAudioAsset | null {
  if (raw === undefined || raw === null) return null;
  if (!isObject(raw)) return null;
  if (typeof raw.storage_key !== "string" || raw.storage_key.length === 0) {
    return null;
  }
  if (!isPositiveInt(raw.duration_sec)) return null;
  if (typeof raw.sha256 !== "string" || !SHA256_HEX.test(raw.sha256)) {
    return null;
  }
  if (typeof raw.format !== "string") return null;
  if (!AUDIO_FORMATS.has(raw.format as ListeningAudioFormat)) return null;
  return {
    storage_key: raw.storage_key,
    duration_sec: raw.duration_sec,
    sha256: raw.sha256,
    format: raw.format as ListeningAudioFormat,
  };
}

// ─── Part + content ─────────────────────────────────────────────────────

function parsePart(
  raw: unknown,
  expectedPart: ListeningPartNumber,
  globalQuestionPositions: Set<number>,
  globalSlotIds: Set<string>,
): ListeningPart | null {
  if (!isObject(raw)) return null;
  if (raw.part !== expectedPart) return null;
  if (typeof raw.context !== "string") return null;
  if (!PART_CONTEXTS.has(raw.context as ListeningPartContext)) return null;
  if (typeof raw.title !== "string" || raw.title.length === 0) return null;

  const speakers = parseSpeakers(raw.speakers);
  if (!speakers) return null;
  const speakerIds = new Set(speakers.map((s) => s.id));

  const qPositions = parseNumberArray(raw.question_positions);
  if (!qPositions || qPositions.length === 0) return null;
  // Positions must be globally unique across all parts in the content.
  const partPositionSet = new Set<number>();
  for (const p of qPositions) {
    if (globalQuestionPositions.has(p)) return null;
    if (partPositionSet.has(p)) return null;
    globalQuestionPositions.add(p);
    partPositionSet.add(p);
  }

  const transcript = parseTranscript(raw.transcript, speakerIds, partPositionSet);
  if (!transcript) return null;

  const blocks = parseCompletionBlocks(raw.completion_blocks, globalSlotIds);
  if (blocks === null) return null;

  // audio_asset is OPTIONAL: undefined/null = "not yet synthesised". A
  // present-but-malformed asset is treated as a hard error (rather than
  // silently dropped) so a generation bug doesn't ship as "no audio".
  let audio: ListeningAudioAsset | undefined;
  if (raw.audio_asset !== undefined && raw.audio_asset !== null) {
    const parsed = parseAudioAsset(raw.audio_asset);
    if (!parsed) return null;
    audio = parsed;
  }

  return {
    part: expectedPart,
    context: raw.context as ListeningPartContext,
    title: raw.title,
    speakers,
    transcript,
    question_positions: qPositions,
    completion_blocks: blocks.length > 0 ? blocks : undefined,
    audio_asset: audio,
  };
}

export function parseListeningContent(raw: unknown): ListeningContent | null {
  if (!isObject(raw)) return null;
  if (raw.schema_version !== 1) return null;
  if (!Array.isArray(raw.parts)) return null;
  if (raw.parts.length !== 4) return null;

  const globalQuestionPositions = new Set<number>();
  const globalSlotIds = new Set<string>();
  const parts: ListeningPart[] = [];
  for (let i = 0; i < 4; i += 1) {
    const expected = (i + 1) as ListeningPartNumber;
    const p = parsePart(
      raw.parts[i],
      expected,
      globalQuestionPositions,
      globalSlotIds,
    );
    if (!p) return null;
    parts.push(p);
  }
  return { schema_version: 1, parts };
}

// ─── Lookup helpers (used by the runner + grader) ───────────────────────

// Given parsed content and a Question.position, return the part it belongs
// to. Returns null if the position is not part of any part — that is a
// content bug, and the runner should refuse to render the question.
export function partForQuestionPosition(
  content: ListeningContent,
  position: number,
): ListeningPart | null {
  for (const p of content.parts) {
    if (p.question_positions.includes(position)) return p;
  }
  return null;
}

// Convenience: find a completion block by id across all parts. Returns null
// when no block matches — the grader treats that as a malformed payload.
export function findCompletionBlock(
  content: ListeningContent,
  blockId: string,
): { part: ListeningPart; block: ListeningCompletionBlock } | null {
  for (const p of content.parts) {
    if (!p.completion_blocks) continue;
    for (const b of p.completion_blocks) {
      if (b.id === blockId) return { part: p, block: b };
    }
  }
  return null;
}
