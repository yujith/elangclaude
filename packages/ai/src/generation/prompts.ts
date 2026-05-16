// Prompt loader for generation. Mirrors grading/prompts.ts: reads
// versioned Markdown from prompts/generation/, strips frontmatter, caches
// per process.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stripFrontmatter } from "../grading/prompts";

export type GenerationKind =
  | "reading"
  | "writing"
  | "speaking"
  | "listening";

const FILENAMES: Record<GenerationKind, string> = {
  reading: "reading.md",
  writing: "writing.md",
  speaking: "speaking.md",
  listening: "listening.md",
};

const cache = new Map<GenerationKind, string>();

function promptsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // packages/ai/src/generation → ../../.. → repo root → prompts/generation
  return resolve(here, "..", "..", "..", "..", "prompts", "generation");
}

export function loadGenerationPrompt(kind: GenerationKind): string {
  const hit = cache.get(kind);
  if (hit !== undefined) return hit;
  const path = resolve(promptsDir(), FILENAMES[kind]);
  const raw = readFileSync(path, "utf-8");
  const body = stripFrontmatter(raw).trim();
  cache.set(kind, body);
  return body;
}

export type GenerationPromptLoader = (kind: GenerationKind) => string;
