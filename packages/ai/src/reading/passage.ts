// Reading passage payload parser.
//
// The DB stores `Test.body_json` as arbitrary JSON. This module owns the
// shape and the parser. A malformed row returns `null`; the runner refuses
// to start an attempt rather than render half-broken UI.
//
// Paragraph labels (A, B, C, …) are canonical — matching-question correct
// answers in later phases will reference them.

export type ReadingParagraph = {
  label: string;
  text: string;
};

// Shared bank for matching-* question types. The same bank can be the
// target for several questions on the same passage (e.g. questions 1–6
// all pick from the same heading list). Each question's correct_answer
// references this group by id.
export type MatchingGroupKind = "headings" | "features" | "sentence-endings";

export type MatchingGroup = {
  id: string;
  kind: MatchingGroupKind;
  // Optional display label, e.g. "List of headings".
  label?: string;
  // Stable keys + the text the learner reads.
  items: { key: string; text: string }[];
  // When true, the UI surfaces an "NB you may use any letter more than
  // once" hint. The grader is per-question regardless.
  allow_reuse?: boolean;
};

// Completion blocks back every Phase 4 question kind that isn't a plain
// sentence-completion or short-answer: summary fill-in, notes, tables,
// flow-charts, and labelled diagrams. Each blank slot has a stable id;
// reading-completion-blank questions reference (block_id, slot_id).
export type CompletionLayout =
  | "summary"
  | "notes"
  | "table"
  | "flow-chart"
  | "diagram";

export type Segment =
  | { kind: "text"; text: string }
  | { kind: "blank"; slot_id: string };

export type CompletionRow = {
  // Optional leading label — e.g. the bullet key on notes ("Time:"),
  // the step number on a flow-chart, the area name on a diagram callout,
  // or the row's first-cell header on a table. Renderer decides how to
  // present it per layout.
  label?: string;
  // For `table` rows, when true the row is rendered in <thead> and must
  // not contain any blank segments. For other layouts this is ignored.
  is_header?: boolean;
  // Always an array of cells. For non-table layouts there is conventionally
  // exactly one cell whose segments are rendered inline.
  cells: Segment[][];
};

export type CompletionBlock = {
  id: string;
  layout: CompletionLayout;
  title?: string;
  // Optional instruction line, e.g. "Write NO MORE THAN TWO WORDS for
  // each answer." Surfaced once per block.
  instructions?: string;
  rows: CompletionRow[];
};

// IELTS GT Reading has three sections by topic: social-survival
// (everyday texts), workplace (work-related texts), and general-reading
// (a longer general-interest article). Tagging GT passages with their
// section lets the picker resemble the real exam structure. Academic
// passages leave this field unset.
export type GtContext = "social-survival" | "workplace" | "general-reading";

// The passage's position within a full IELTS Reading paper: Part 1, 2, or
// 3. For Academic, this is an explicit label the SuperAdmin stamps at
// generation time (the three passages escalate in difficulty). For GT the
// canonical part is derived from `gt_context` (social-survival → 1,
// workplace → 2, general-reading → 3) — see `readingPart()` — so GT rows
// leave this field unset rather than store the part twice. Used by the
// learner picker's part filter and as a hint when curating a full paper.
export type ReadingPart = 1 | 2 | 3;

export type ReadingPassage = {
  title?: string;
  paragraphs: ReadingParagraph[];
  matching_groups?: MatchingGroup[];
  completion_blocks?: CompletionBlock[];
  gt_context?: GtContext;
  part?: ReadingPart;
  word_count?: number;
};

// Canonical Part 1/2/3 for a passage. GT derives it from gt_context so the
// section name and the part number never disagree; Academic uses the
// stamped `part`. Returns null when neither is set (unlabelled — shows as
// "Part —" and only under the picker's "All parts" view).
const GT_CONTEXT_PART: Record<GtContext, ReadingPart> = {
  "social-survival": 1,
  workplace: 2,
  "general-reading": 3,
};

export function readingPart(passage: {
  gt_context?: GtContext;
  part?: ReadingPart;
}): ReadingPart | null {
  if (passage.gt_context) return GT_CONTEXT_PART[passage.gt_context];
  return passage.part ?? null;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function stringOrUndef(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

const MATCHING_KINDS: ReadonlySet<MatchingGroupKind> = new Set<MatchingGroupKind>([
  "headings",
  "features",
  "sentence-endings",
]);

function parseMatchingGroups(raw: unknown): MatchingGroup[] | null {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) return null;
  const out: MatchingGroup[] = [];
  const seenIds = new Set<string>();
  for (const g of raw) {
    if (!isObject(g)) return null;
    if (typeof g.id !== "string" || g.id.length === 0) return null;
    if (seenIds.has(g.id)) return null;
    if (typeof g.kind !== "string") return null;
    if (!MATCHING_KINDS.has(g.kind as MatchingGroupKind)) return null;
    if (!Array.isArray(g.items)) return null;
    const items: { key: string; text: string }[] = [];
    const itemKeys = new Set<string>();
    for (const it of g.items) {
      if (!isObject(it)) return null;
      if (typeof it.key !== "string" || it.key.length === 0) return null;
      if (typeof it.text !== "string" || it.text.length === 0) return null;
      if (itemKeys.has(it.key)) return null;
      itemKeys.add(it.key);
      items.push({ key: it.key, text: it.text });
    }
    if (items.length < 2) return null;
    seenIds.add(g.id);
    out.push({
      id: g.id,
      kind: g.kind as MatchingGroupKind,
      label: stringOrUndef(g.label),
      items,
      allow_reuse:
        typeof g.allow_reuse === "boolean" ? g.allow_reuse : undefined,
    });
  }
  return out;
}

const COMPLETION_LAYOUTS: ReadonlySet<CompletionLayout> = new Set<CompletionLayout>([
  "summary",
  "notes",
  "table",
  "flow-chart",
  "diagram",
]);

function parseSegment(raw: unknown): Segment | null {
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

function parseSegments(raw: unknown): Segment[] | null {
  if (!Array.isArray(raw)) return null;
  const out: Segment[] = [];
  for (const s of raw) {
    const seg = parseSegment(s);
    if (!seg) return null;
    out.push(seg);
  }
  return out;
}

function parseCompletionRow(raw: unknown): CompletionRow | null {
  if (!isObject(raw)) return null;
  if (!Array.isArray(raw.cells)) return null;
  const cells: Segment[][] = [];
  for (const c of raw.cells) {
    const segs = parseSegments(c);
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

function parseCompletionBlocks(raw: unknown): CompletionBlock[] | null {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) return null;
  const seenIds = new Set<string>();
  const seenSlotIds = new Set<string>();
  const out: CompletionBlock[] = [];
  for (const b of raw) {
    if (!isObject(b)) return null;
    if (typeof b.id !== "string" || b.id.length === 0) return null;
    if (seenIds.has(b.id)) return null;
    if (typeof b.layout !== "string") return null;
    if (!COMPLETION_LAYOUTS.has(b.layout as CompletionLayout)) return null;
    if (!Array.isArray(b.rows)) return null;
    const rows: CompletionRow[] = [];
    for (const r of b.rows) {
      const row = parseCompletionRow(r);
      if (!row) return null;
      // Header rows must not contain blanks (per the spec).
      if (row.is_header) {
        for (const cell of row.cells) {
          if (cell.some((s) => s.kind === "blank")) return null;
        }
      }
      // Slot ids must be globally unique across all completion blocks on
      // the passage, so questions can reference (block_id, slot_id)
      // unambiguously.
      for (const cell of row.cells) {
        for (const seg of cell) {
          if (seg.kind === "blank") {
            if (seenSlotIds.has(seg.slot_id)) return null;
            seenSlotIds.add(seg.slot_id);
          }
        }
      }
      rows.push(row);
    }
    if (rows.length === 0) return null;
    seenIds.add(b.id);
    out.push({
      id: b.id,
      layout: b.layout as CompletionLayout,
      title: stringOrUndef(b.title),
      instructions: stringOrUndef(b.instructions),
      rows,
    });
  }
  return out;
}

const GT_CONTEXTS: ReadonlySet<GtContext> = new Set<GtContext>([
  "social-survival",
  "workplace",
  "general-reading",
]);

function parseGtContext(raw: unknown): GtContext | undefined {
  if (typeof raw !== "string") return undefined;
  return GT_CONTEXTS.has(raw as GtContext) ? (raw as GtContext) : undefined;
}

function parseReadingPart(raw: unknown): ReadingPart | undefined {
  return raw === 1 || raw === 2 || raw === 3 ? raw : undefined;
}

// IELTS Reading passages only carry visible paragraph letters (A, B, C, …)
// when the question set references them: matching-headings ("Pick a
// heading for Paragraph B") or matching-information ("Which paragraph
// mentions X"). For MCQ / T/F/NG / sentence-completion / short-answer /
// completion-blank / matching-features / matching-sentence-endings the
// passage flows as continuous prose with no letter prefix.
//
// The `label` field on each paragraph is always stored — it's part of the
// canonical addressing on body_json — but the renderer asks this helper
// whether to *display* it. Question types are passed in by string so
// callers don't have to import the kind union.
export function passageNeedsParagraphLabels(
  questionTypes: readonly string[],
): boolean {
  for (const t of questionTypes) {
    if (
      t === "reading-matching-headings" ||
      t === "reading-matching-information"
    ) {
      return true;
    }
  }
  return false;
}

export function parseReadingPassage(raw: unknown): ReadingPassage | null {
  if (!isObject(raw)) return null;
  if (!Array.isArray(raw.paragraphs)) return null;
  const paragraphs: ReadingParagraph[] = [];
  for (const p of raw.paragraphs) {
    if (!isObject(p)) return null;
    if (typeof p.label !== "string" || p.label.length === 0) return null;
    if (typeof p.text !== "string" || p.text.length === 0) return null;
    paragraphs.push({ label: p.label, text: p.text });
  }
  if (paragraphs.length === 0) return null;
  const groups = parseMatchingGroups(raw.matching_groups);
  if (groups === null) return null;
  const blocks = parseCompletionBlocks(raw.completion_blocks);
  if (blocks === null) return null;
  return {
    title: stringOrUndef(raw.title),
    paragraphs,
    matching_groups: groups.length > 0 ? groups : undefined,
    completion_blocks: blocks.length > 0 ? blocks : undefined,
    gt_context: parseGtContext(raw.gt_context),
    part: parseReadingPart(raw.part),
    word_count:
      typeof raw.word_count === "number" && Number.isFinite(raw.word_count)
        ? raw.word_count
        : undefined,
  };
}
