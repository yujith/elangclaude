import {
  generatedWritingSchema,
  validateGeneratedWriting,
  type GeneratedWriting,
} from "@elc/ai";
import { isWritingTaskType } from "./task";
import { parseVisual } from "./visual";

type Track = "Academic" | "GeneralTraining";

type ReviewQuestion = {
  type: string;
  prompt: string;
  visual: unknown;
};

export type WritingReviewRecord = {
  track: Track;
  difficulty: number;
  body_json: unknown;
  question: ReviewQuestion;
};

export type WritingReviewValidationResult =
  | { ok: true; generated: GeneratedWriting }
  | {
      ok: false;
      reason: "schema" | "validation" | "visual";
      issueCodes: string[];
    };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uniqueIssueCodes(codes: string[]): string[] {
  return codes.filter((code, index, arr) => arr.indexOf(code) === index);
}

function readBodyMetaValue(raw: unknown): unknown {
  if (!isObject(raw)) return undefined;
  return raw.body_meta;
}

function buildGeneratedWritingCandidate(
  record: WritingReviewRecord,
): unknown | null {
  if (!isWritingTaskType(record.question.type)) return null;

  const candidate: Record<string, unknown> = {
    task_kind: record.question.type,
    track: record.track,
    difficulty: record.difficulty,
    prompt: record.question.prompt,
    body_meta: readBodyMetaValue(record.body_json),
  };

  if (record.question.type === "writing-task-1-academic") {
    candidate.visual = record.question.visual;
  }

  return candidate;
}

export function validateWritingReviewRecord(
  record: WritingReviewRecord,
): WritingReviewValidationResult {
  const candidate = buildGeneratedWritingCandidate(record);
  if (!candidate) {
    return {
      ok: false,
      reason: "schema",
      issueCodes: ["schema.invalid-generated-writing"],
    };
  }

  const parsed = generatedWritingSchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "schema",
      issueCodes: ["schema.invalid-generated-writing"],
    };
  }

  const validation = validateGeneratedWriting(parsed.data);
  if (!validation.ok) {
    return {
      ok: false,
      reason: "validation",
      issueCodes: uniqueIssueCodes(validation.issues.map((issue) => issue.code)),
    };
  }

  if (
    parsed.data.task_kind === "writing-task-1-academic" &&
    parseVisual(parsed.data.visual) === null
  ) {
    return {
      ok: false,
      reason: "visual",
      issueCodes: ["visual.unrenderable-academic-task-1"],
    };
  }

  return { ok: true, generated: parsed.data };
}

export function readWritingBodyMeta(
  raw: unknown,
): { label: string; value: string }[] {
  const meta = readBodyMetaValue(raw);
  if (!isObject(meta)) return [];

  const out: { label: string; value: string }[] = [];
  for (const [key, value] of Object.entries(meta)) {
    if (typeof value === "string" && value.length > 0) {
      out.push({ label: key.replace(/_/g, " "), value });
    }
  }
  return out;
}

export function serializeWritingIssueCodes(issueCodes: string[]): string {
  return uniqueIssueCodes(issueCodes).join(",");
}

export function parseWritingIssueCodes(raw: string | undefined): string[] {
  if (!raw) return [];
  return uniqueIssueCodes(
    raw
      .split(",")
      .map((code) => code.trim())
      .filter((code) => code.length > 0),
  );
}
