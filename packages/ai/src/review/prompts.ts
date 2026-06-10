// Prompt loader for automated content review (ADR-0024). Mirrors
// generation/prompts.ts: reads versioned Markdown from prompts/review/,
// strips frontmatter, caches per process.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stripFrontmatter } from "../grading/prompts";

export type ReviewSection = "reading" | "listening" | "writing" | "speaking";

const FILENAMES: Record<ReviewSection, string> = {
  reading: "reading.md",
  listening: "listening.md",
  writing: "writing.md",
  speaking: "speaking.md",
};

const cache = new Map<ReviewSection, string>();

function promptsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // packages/ai/src/review → ../../.. → repo root → prompts/review
  return resolve(here, "..", "..", "..", "..", "prompts", "review");
}

export function loadReviewPrompt(section: ReviewSection): string {
  const hit = cache.get(section);
  if (hit !== undefined) return hit;
  const path = resolve(promptsDir(), FILENAMES[section]);
  const raw = readFileSync(path, "utf-8");
  const body = stripFrontmatter(raw).trim();
  cache.set(section, body);
  return body;
}

export type ReviewPromptLoader = (section: ReviewSection) => string;
