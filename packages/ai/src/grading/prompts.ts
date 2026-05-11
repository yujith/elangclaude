// Prompt loader for grading. Reads versioned Markdown files from the
// repo-root `prompts/grading/` directory, strips frontmatter, and returns
// the prompt body verbatim.
//
// In dev, `process.cwd()` is the repo root when developers run `pnpm dev`.
// We resolve relative to this file's location (via import.meta.url) so the
// loader doesn't depend on cwd — important when the gateway runs inside
// a Next.js server action where the cwd is `apps/web/`.
//
// Production deployment note: ensure the deployment includes
// `prompts/grading/**` (Next's `outputFileTracingIncludes` covers this when
// we ship to Vercel). Until then, this loader is safe for local dev and
// for any host where the repo is cloned verbatim.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type WritingTaskKind =
  | "writing-task-1-academic"
  | "writing-task-1-general"
  | "writing-task-2";

const FILENAMES: Record<WritingTaskKind, string> = {
  "writing-task-1-academic": "writing-task-1-academic.md",
  "writing-task-1-general": "writing-task-1-general.md",
  "writing-task-2": "writing-task-2.md",
};

const cache = new Map<WritingTaskKind, string>();

function promptsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // packages/ai/src/grading → ../../.. → repo root → prompts/grading
  return resolve(here, "..", "..", "..", "..", "prompts", "grading");
}

export function stripFrontmatter(raw: string): string {
  // Markdown frontmatter is `---\n...\n---\n` at the very start of the file.
  // We strip it but keep everything after, including any leading blank lines.
  return raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
}

export function loadWritingPrompt(kind: WritingTaskKind): string {
  const hit = cache.get(kind);
  if (hit !== undefined) return hit;
  const path = resolve(promptsDir(), FILENAMES[kind]);
  const raw = readFileSync(path, "utf-8");
  const body = stripFrontmatter(raw).trim();
  cache.set(kind, body);
  return body;
}

export type PromptLoader = (kind: WritingTaskKind) => string;
