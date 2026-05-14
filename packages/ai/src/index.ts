// Public surface for `@elc/ai`. Mirrors the no-barrel-glob discipline of
// `@elc/db/index.ts` — only the symbols routes actually use.

export { ai, createAI } from "./gateway";
export type { ChatRequest, ChatResponse, GatewayDeps } from "./gateway";

export type { Purpose, ProviderName } from "./models";
export { allowedModelsFor, getDefaultModel, isModelAllowed } from "./models";

export {
  GradeShapeError,
  GenerationShapeError,
  GenerationValidationError,
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

// ─── Reading (deterministic, no AI on submit) ───────────────────────────
export {
  parseReadingPassage,
  passageNeedsParagraphLabels,
} from "./reading/passage";
export type {
  ReadingPassage,
  ReadingParagraph,
  MatchingGroup,
  MatchingGroupKind,
  CompletionBlock,
  CompletionLayout,
  CompletionRow,
  Segment as ReadingSegment,
  GtContext,
} from "./reading/passage";

export {
  READING_QUESTION_KINDS,
  isReadingQuestionKind,
  parseQuestionPayload as parseReadingQuestionPayload,
  parseReadingResponse,
} from "./reading/question-types";
export type {
  ReadingQuestionKind,
  ReadingQuestionPayload,
  ReadingResponse,
  McqOption,
  McqPayload,
  TfngLabel,
  TfngPayload,
  YnngLabel,
  YnngPayload,
  SentenceCompletionPayload,
  McqResponse,
  TfngResponse,
  YnngResponse,
  SentenceCompletionResponse,
  MatchingHeadingsPayload,
  MatchingInformationPayload,
  MatchingFeaturesPayload,
  MatchingSentenceEndingsPayload,
  MatchingHeadingsResponse,
  MatchingInformationResponse,
  MatchingFeaturesResponse,
  MatchingSentenceEndingsResponse,
  ShortAnswerPayload,
  CompletionBlankPayload,
  ShortAnswerResponse,
  CompletionBlankResponse,
} from "./reading/question-types";

export { gradeReadingAttempt, parseReadingGrade } from "./reading/grade";
export type {
  ReadingGrade,
  ReadingGradeInput,
  ReadingGradeQuestion,
  ReadingGradeAnswer,
  ReadingBreakdownItem,
} from "./reading/grade";

export { bandFromRaw40, bandFromPartial, scaleRawTo40 } from "./reading/band";

export { persistReadingGrade, ReadingPersistError } from "./reading/persist";
export type { PersistResult as ReadingPersistResult } from "./reading/persist";

// ─── Reading generation (Phase 5) ───────────────────────────────────────
export {
  createReadingGenerator,
  readingGenerator,
} from "./generation/reading";
export type {
  GenerateReadingRequest,
  GenerateReadingResult,
  ReadingGeneratorDeps,
} from "./generation/reading";

export {
  generatedReadingSchema,
  parseGeneratedReading,
} from "./generation/schema";
export type {
  GeneratedReading,
  GeneratedReadingQuestion,
} from "./generation/schema";

export { validateGeneratedReading } from "./generation/validate";
export type {
  ValidationIssue as GenerationValidationIssue,
  ValidationResult as GenerationValidationResult,
} from "./generation/validate";

export { persistGeneratedReading } from "./generation/persist";
export type {
  PersistResult as GeneratedReadingPersistResult,
} from "./generation/persist";

export { loadGenerationPrompt } from "./generation/prompts";
export type { GenerationKind, GenerationPromptLoader } from "./generation/prompts";

// ─── Writing generation ─────────────────────────────────────────────────
export {
  createWritingGenerator,
  writingGenerator,
} from "./generation/writing";
export type {
  GenerateWritingRequest,
  GenerateWritingResult,
  WritingGeneratorDeps,
} from "./generation/writing";

export {
  generatedWritingSchema,
  parseGeneratedWriting,
} from "./generation/writing-schema";
export type {
  GeneratedWriting,
  GeneratedWritingTask1Academic,
  GeneratedWritingTask1General,
  GeneratedWritingTask2,
  GeneratedWritingVisual,
} from "./generation/writing-schema";

export { validateGeneratedWriting } from "./generation/writing-validate";
export type {
  WritingValidationIssue,
  WritingValidationResult,
} from "./generation/writing-validate";

export { persistGeneratedWriting } from "./generation/writing-persist";
export type {
  PersistWritingResult as GeneratedWritingPersistResult,
} from "./generation/writing-persist";
