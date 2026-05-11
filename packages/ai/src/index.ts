// Public surface for `@elc/ai`. Mirrors the no-barrel-glob discipline of
// `@elc/db/index.ts` — only the symbols routes actually use.

export { ai, createAI } from "./gateway";
export type { ChatRequest, ChatResponse, GatewayDeps } from "./gateway";

export type { Purpose, ProviderName } from "./models";
export { allowedModelsFor, getDefaultModel, isModelAllowed } from "./models";

export {
  GradeShapeError,
  ModelNotAllowedError,
  ProviderError,
  QuotaExceededError,
} from "./errors";

export { parseWritingGrade, writingGradeSchema } from "./grading/schema";
export type { WritingGrade } from "./grading/schema";

export { createWritingGrader, writingGrader } from "./grading/writing";
export type {
  GradeOutput,
  GradeRequest,
  WritingGraderDeps,
} from "./grading/writing";
export type { WritingTaskKind } from "./grading/prompts";
export { loadWritingPrompt, stripFrontmatter } from "./grading/prompts";
