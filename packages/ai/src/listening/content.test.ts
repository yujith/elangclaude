import { describe, expect, it } from "vitest";
import {
  findCompletionBlock,
  parseListeningContent,
  partForQuestionPosition,
  type ListeningContent,
} from "./content";
import { sampleListeningContent } from "./fixtures";

// Helpers — deep-clone the fixture so per-test mutations don't bleed across
// the suite. structuredClone is built into Node 18+.
function cloneFixture(): ListeningContent {
  return structuredClone(sampleListeningContent);
}

// Parse-and-assert helper so happy-path tests don't have to '!'-everywhere.
function parseFixture(input: unknown = cloneFixture()): ListeningContent {
  const parsed = parseListeningContent(input);
  if (!parsed) throw new Error("parseListeningContent unexpectedly returned null");
  return parsed;
}

describe("parseListeningContent — happy path", () => {
  it("round-trips the hand-authored fixture", () => {
    const parsed = parseFixture();
    expect(parsed.parts).toHaveLength(4);
    expect(parsed.parts.map((p) => p.part)).toEqual([1, 2, 3, 4]);
  });

  it("preserves speakers per part", () => {
    const parsed = parseFixture();
    expect(parsed.parts[0]!.speakers.map((s) => s.id)).toEqual([
      "narrator",
      "receptionist",
      "caller",
    ]);
    expect(parsed.parts[2]!.speakers).toHaveLength(4);
  });

  it("preserves the accent variety across the 4 parts", () => {
    const parsed = parseFixture();
    const accents = new Set<string>();
    for (const p of parsed.parts) {
      for (const sp of p.speakers) accents.add(sp.accent);
    }
    expect(accents).toEqual(
      new Set([
        "british",
        "australian",
        "american",
        "canadian",
        "new-zealand",
      ]),
    );
  });

  it("preserves completion block layouts (form, notes, table)", () => {
    const parsed = parseFixture();
    expect(parsed.parts[0]!.completion_blocks?.[0]!.layout).toBe("form");
    expect(parsed.parts[1]!.completion_blocks?.[0]!.layout).toBe("notes");
    expect(parsed.parts[2]!.completion_blocks?.[0]!.layout).toBe("table");
    expect(parsed.parts[3]!.completion_blocks).toBeUndefined();
  });

  it("returns transcript segments in order", () => {
    const parsed = parseFixture();
    expect(parsed.parts[0]!.transcript[0]).toEqual({
      kind: "narration",
      text: "Now turn to Part 1.",
    });
  });

  it("leaves audio_asset undefined when omitted (Phase 1 default)", () => {
    const parsed = parseFixture();
    for (const p of parsed.parts) {
      expect(p.audio_asset).toBeUndefined();
    }
  });
});

describe("parseListeningContent — accepts a populated audio_asset", () => {
  it("preserves a well-formed audio_asset", () => {
    const content = cloneFixture() as unknown as {
      parts: Record<string, unknown>[];
    };
    content.parts[0]!.audio_asset = {
      storage_key: "audio/abc.mp3",
      duration_sec: 240,
      sha256: "a".repeat(64),
      format: "mp3",
    };
    const parsed = parseFixture(content);
    expect(parsed.parts[0]!.audio_asset).toEqual({
      storage_key: "audio/abc.mp3",
      duration_sec: 240,
      sha256: "a".repeat(64),
      format: "mp3",
    });
  });
});

describe("parseListeningContent — outer shape rejections", () => {
  it("rejects a non-object", () => {
    expect(parseListeningContent("nope")).toBeNull();
    expect(parseListeningContent(null)).toBeNull();
    expect(parseListeningContent([])).toBeNull();
  });

  it("rejects the wrong schema_version", () => {
    const bad = cloneFixture() as unknown as Record<string, unknown>;
    bad.schema_version = 2;
    expect(parseListeningContent(bad)).toBeNull();
  });

  it("rejects when parts is not an array of length 4", () => {
    const tooShort = cloneFixture() as unknown as { parts: unknown[] };
    tooShort.parts = tooShort.parts.slice(0, 3);
    expect(parseListeningContent(tooShort)).toBeNull();
  });

  it("rejects out-of-order part numbers", () => {
    const reordered = cloneFixture() as unknown as { parts: unknown[] };
    [reordered.parts[0], reordered.parts[1]] = [
      reordered.parts[1],
      reordered.parts[0],
    ];
    expect(parseListeningContent(reordered)).toBeNull();
  });
});

describe("parseListeningContent — per-part rejections", () => {
  it("rejects an unknown accent", () => {
    const bad = cloneFixture() as unknown as {
      parts: { speakers: { accent: string }[] }[];
    };
    bad.parts[0]!.speakers[0]!.accent = "irish";
    expect(parseListeningContent(bad)).toBeNull();
  });

  it("rejects a speech segment referencing an undefined speaker_id", () => {
    const bad = cloneFixture() as unknown as {
      parts: { transcript: Record<string, unknown>[] }[];
    };
    // Replace the first speech segment with one pointing at a phantom id.
    const transcript = bad.parts[0]!.transcript;
    const idx = transcript.findIndex((s) => s.kind === "speech");
    expect(idx).toBeGreaterThanOrEqual(0);
    transcript[idx] = {
      kind: "speech",
      speaker_id: "ghost",
      text: "Hello?",
    };
    expect(parseListeningContent(bad)).toBeNull();
  });

  it("rejects a questions-preview pointing at a position outside the part", () => {
    const bad = cloneFixture() as unknown as {
      parts: { transcript: Record<string, unknown>[] }[];
    };
    const transcript = bad.parts[0]!.transcript;
    const idx = transcript.findIndex((s) => s.kind === "questions-preview");
    expect(idx).toBeGreaterThanOrEqual(0);
    transcript[idx] = {
      kind: "questions-preview",
      seconds: 20,
      question_positions: [99],
    };
    expect(parseListeningContent(bad)).toBeNull();
  });

  it("rejects duplicate question_positions across parts", () => {
    const bad = cloneFixture() as unknown as {
      parts: { question_positions: number[] }[];
    };
    const dup = bad.parts[0]!.question_positions[0]!;
    bad.parts[1]!.question_positions[0] = dup;
    expect(parseListeningContent(bad)).toBeNull();
  });

  it("rejects duplicate slot_id across completion blocks in different parts", () => {
    type MutBlock = {
      rows: { cells: { kind: string; slot_id?: string; text?: string }[][] }[];
    };
    const bad = cloneFixture() as unknown as {
      parts: { completion_blocks?: MutBlock[] }[];
    };
    const part1Block = bad.parts[0]!.completion_blocks?.[0];
    const part2Block = bad.parts[1]!.completion_blocks?.[0];
    if (!part1Block || !part2Block) {
      throw new Error("fixture is missing the expected completion blocks");
    }
    const slotInPart1 = part1Block.rows[0]!.cells[0]![0]!.slot_id;
    if (!slotInPart1) {
      throw new Error("fixture's first part1 cell has no slot_id");
    }
    // Replace a Part 2 blank with the Part 1 slot id — should reject because
    // slot ids are globally unique across the whole ListeningContent.
    part2Block.rows[0]!.cells[0] = [{ kind: "blank", slot_id: slotInPart1 }];
    expect(parseListeningContent(bad)).toBeNull();
  });

  it("rejects a header row that contains blanks", () => {
    type MutBlock = {
      rows: {
        is_header?: boolean;
        cells: { kind: string; slot_id?: string; text?: string }[][];
      }[];
    };
    const bad = cloneFixture() as unknown as {
      parts: { completion_blocks?: MutBlock[] }[];
    };
    const block = bad.parts[2]!.completion_blocks?.[0];
    if (!block) throw new Error("part 3 fixture missing completion block");
    block.rows[0]!.cells[0] = [{ kind: "blank", slot_id: "header-blank" }];
    expect(parseListeningContent(bad)).toBeNull();
  });

  it("rejects a malformed audio_asset (bad sha256)", () => {
    const bad = cloneFixture() as unknown as {
      parts: Record<string, unknown>[];
    };
    bad.parts[0]!.audio_asset = {
      storage_key: "audio/abc.mp3",
      duration_sec: 240,
      sha256: "not-hex",
      format: "mp3",
    };
    expect(parseListeningContent(bad)).toBeNull();
  });

  it("rejects an audio_asset with an unsupported format", () => {
    const bad = cloneFixture() as unknown as {
      parts: Record<string, unknown>[];
    };
    bad.parts[0]!.audio_asset = {
      storage_key: "audio/abc.aac",
      duration_sec: 240,
      sha256: "a".repeat(64),
      format: "aac",
    };
    expect(parseListeningContent(bad)).toBeNull();
  });
});

describe("partForQuestionPosition", () => {
  it("resolves positions to their parent part", () => {
    const parsed = parseFixture();
    expect(partForQuestionPosition(parsed, 0)?.part).toBe(1);
    expect(partForQuestionPosition(parsed, 5)?.part).toBe(2);
    expect(partForQuestionPosition(parsed, 10)?.part).toBe(3);
    expect(partForQuestionPosition(parsed, 15)?.part).toBe(4);
  });

  it("returns null for an unknown position", () => {
    const parsed = parseFixture();
    expect(partForQuestionPosition(parsed, 999)).toBeNull();
  });
});

describe("findCompletionBlock", () => {
  it("finds a block by id across any part", () => {
    const parsed = parseFixture();
    expect(findCompletionBlock(parsed, "p1-form")?.part.part).toBe(1);
    expect(findCompletionBlock(parsed, "p2-notes")?.part.part).toBe(2);
    expect(findCompletionBlock(parsed, "p3-table")?.part.part).toBe(3);
  });

  it("returns null for an unknown block id", () => {
    const parsed = parseFixture();
    expect(findCompletionBlock(parsed, "nope")).toBeNull();
  });
});
