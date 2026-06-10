// Zod schema for the reviewer verdict (ADR-0024).
//
// Contract source: prompts/review/{section}.md — all four sections share
// one verdict shape. The reviewer must return a single JSON object; the
// pipeline retries once with a stricter nudge on failure, then surfaces
// ReviewShapeError rather than fabricate a verdict.

import { z } from "zod";

export const reviewIssueSchema = z.object({
  severity: z.enum(["critical", "minor"]),
  category: z.string().min(1).max(80),
  detail: z.string().min(1).max(2000),
});

export const reviewVerdictSchema = z
  .object({
    verdict: z.enum(["approve", "reject"]),
    issues: z.array(reviewIssueSchema).max(30),
    feedback_for_regeneration: z.string().max(6000).nullable(),
  })
  .superRefine((v, ctx) => {
    if (v.verdict === "reject") {
      if (
        v.feedback_for_regeneration === null ||
        v.feedback_for_regeneration.trim().length === 0
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["feedback_for_regeneration"],
          message:
            "A reject verdict must carry non-empty feedback_for_regeneration.",
        });
      }
      if (!v.issues.some((i) => i.severity === "critical")) {
        ctx.addIssue({
          code: "custom",
          path: ["issues"],
          message: "A reject verdict must carry at least one critical issue.",
        });
      }
    }
  });

export type ReviewIssue = z.infer<typeof reviewIssueSchema>;
export type ReviewVerdict = z.infer<typeof reviewVerdictSchema>;

export type ReviewParseResult =
  | { ok: true; value: ReviewVerdict }
  | { ok: false; issues: z.ZodIssue[]; raw: string };

export function parseReviewVerdict(raw: string): ReviewParseResult {
  const json = extractFirstJsonObject(raw);
  if (json === null) {
    return {
      ok: false,
      issues: [
        {
          code: "custom",
          path: [],
          message: "Response did not contain a JSON object.",
        },
      ],
      raw,
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return {
      ok: false,
      issues: [
        { code: "custom", path: [], message: "Response was not valid JSON." },
      ],
      raw,
    };
  }
  const result = reviewVerdictSchema.safeParse(parsed);
  if (!result.success) {
    return { ok: false, issues: result.error.issues, raw };
  }
  return { ok: true, value: result.data };
}

function extractFirstJsonObject(s: string): string | null {
  const start = s.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      if (inString) escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}
