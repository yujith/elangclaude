// Pure helpers for the Writing module — shared by server (picker, practice
// page, grading prompts) and client (timer, word-count badge). The literal
// task-type union is owned by @elc/ai (next to the grading prompts that
// consume it) — re-exported here as `WritingTaskType` so the existing
// import sites don't all change.

import type { WritingTaskKind } from "@elc/ai";

export type WritingTaskType = WritingTaskKind;

const KNOWN: ReadonlySet<string> = new Set([
  "writing-task-1-academic",
  "writing-task-1-general",
  "writing-task-2",
]);

export function isWritingTaskType(s: string): s is WritingTaskType {
  return KNOWN.has(s);
}

export function taskShortLabel(t: WritingTaskType): string {
  switch (t) {
    case "writing-task-1-academic":
      return "Academic · Task 1";
    case "writing-task-1-general":
      return "General · Task 1";
    case "writing-task-2":
      return "Task 2";
  }
}

export function taskBlurb(t: WritingTaskType): string {
  switch (t) {
    case "writing-task-1-academic":
      return "Describe a graph, chart, process, or diagram in ~150 words.";
    case "writing-task-1-general":
      return "Write a letter (formal, semi-formal, or informal) in ~150 words.";
    case "writing-task-2":
      return "Write a discursive essay in ~250 words.";
  }
}

// IELTS suggests ~20 min for Task 1 and ~40 min for Task 2 within the
// 60-minute session. v1 uses a SOFT timer — no hard cut at zero.
export function timeAllocationMinutes(t: WritingTaskType): number {
  return t === "writing-task-2" ? 40 : 20;
}

export function wordTarget(t: WritingTaskType): number {
  return t === "writing-task-2" ? 250 : 150;
}

export function countWords(s: string): number {
  if (!s) return 0;
  return s.trim().split(/\s+/).filter(Boolean).length;
}
