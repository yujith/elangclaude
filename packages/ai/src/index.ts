// Public surface for `@elc/ai`. Mirrors the no-barrel-glob discipline of
// `@elc/db/index.ts` — only the symbols routes actually use.

export { ai, createAI } from "./gateway";
export type {
  ChatRequest,
  ChatResponse,
  GatewayDeps,
  RealtimeSessionRequest,
  RealtimeSessionResponse,
  TranscribeRequest,
  TranscribeResponse,
  TtsRequest,
  TtsResponse,
} from "./gateway";

export type {
  ChatPurpose,
  Purpose,
  RealtimePurpose,
  TranscribePurpose,
  TtsPurpose,
  ProviderName,
} from "./models";
export {
  allowedModelsFor,
  getDefaultModel,
  isModelAllowed,
  LISTENING_TTS_QUOTA_WEIGHT,
  REALTIME_SESSION_QUOTA_WEIGHT,
  TRANSCRIBE_QUOTA_WEIGHT,
} from "./models";

export type { OpenAIAdapter } from "./adapters/openai";
export type {
  ElevenLabsAdapter,
  ElevenLabsSynthRequest,
  ElevenLabsSynthResult,
} from "./adapters/elevenlabs";
export { ELEVENLABS_DEFAULT_MODEL } from "./adapters/elevenlabs";

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
export {
  loadSpeakingPrompt,
  loadWritingPrompt,
  stripFrontmatter,
} from "./grading/prompts";
export type { SpeakingPromptLoader } from "./grading/prompts";

// ─── Speaking grading (Phase 4) ─────────────────────────────────────────
export {
  parseSpeakingGrade,
  speakingGradeSchema,
} from "./grading/speaking-schema";
export type {
  SpeakingGrade,
  SpeakingParseResult,
} from "./grading/speaking-schema";

export { createSpeakingGrader, speakingGrader } from "./grading/speaking";
export type {
  SpeakingGradeRequest,
  SpeakingGradeOutput,
  SpeakingGraderDeps,
  SpeakingPartKey,
} from "./grading/speaking";

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

// ─── Listening (deterministic, no AI on submit) ─────────────────────────
//
// Phase 1 surface: body_json parser + question-type parsers + the hand-
// authored fixture. Audio synthesis, runner, and grader land in later
// phases (see docs/adr/0007-listening-data-shape.md).
export {
  findCompletionBlock as findListeningCompletionBlock,
  parseListeningContent,
  partForQuestionPosition as partForListeningQuestionPosition,
} from "./listening/content";
export type {
  ListeningAccent,
  ListeningAudioAsset,
  ListeningAudioFormat,
  ListeningCompletionBlock,
  ListeningCompletionLayout,
  ListeningCompletionRow,
  ListeningContent,
  ListeningPart,
  ListeningPartContext,
  ListeningPartNumber,
  ListeningSegment,
  ListeningSegmentCell,
  ListeningSpeaker,
  ListeningSpeakerRole,
} from "./listening/content";

export {
  isListeningQuestionKind,
  LISTENING_QUESTION_KINDS,
  parseListeningQuestionPayload,
  parseListeningResponse,
} from "./listening/question-types";
export type {
  ListeningCompletionBlankPayload,
  ListeningCompletionBlankResponse,
  ListeningMcqMultiPayload,
  ListeningMcqMultiResponse,
  ListeningMcqOption,
  ListeningMcqSinglePayload,
  ListeningMcqSingleResponse,
  ListeningQuestionKind,
  ListeningQuestionPayload,
  ListeningResponse,
  ListeningSentenceCompletionPayload,
  ListeningSentenceCompletionResponse,
  ListeningShortAnswerPayload,
  ListeningShortAnswerResponse,
} from "./listening/question-types";

export {
  sampleListeningContent,
  sampleListeningQuestions,
  sampleListeningTest,
} from "./listening/fixtures";
export type { ListeningFixtureQuestion } from "./listening/fixtures";

// ─── Listening grading (Phase 4 — deterministic) ────────────────────────
export {
  gradeListeningAttempt,
  parseListeningGrade,
} from "./listening/grade";
export type {
  ListeningGrade,
  ListeningGradeAnswer,
  ListeningGradeInput,
  ListeningGradeQuestion,
  ListeningBreakdownItem,
} from "./listening/grade";

export {
  listeningBandFromPartial,
  listeningBandFromRaw40,
  scaleListeningRawTo40,
} from "./listening/band";

export {
  ListeningPersistError,
  persistListeningGrade,
} from "./listening/persist";
export type {
  ListeningPersistDb,
  PersistListeningGradeResult,
} from "./listening/persist";

// ─── Listening TTS (Phase 2) ────────────────────────────────────────────
export {
  DEFAULT_VOICE_CATALOGUE,
  listAccents,
  pickVoiceForSpeaker,
  roleBucket,
} from "./listening/voices";
export type {
  PickedVoice,
  VoiceCatalogue,
  VoicePickerOptions,
  VoiceRole,
} from "./listening/voices";

export {
  attachSynthesizedClips,
  computeAudioClipKey,
  createTtsCache,
  planSynthesisJobs,
  ttsCache,
} from "./listening/tts-cache";
export type {
  AudioClipKey,
  AudioClipKeyInput,
  PlanSynthesisJobsOptions,
  SynthJob,
  SynthesizeAndCacheRequest,
  SynthesizeAndCacheResult,
  SynthesizedClip,
  TtsCacheDeps,
} from "./listening/tts-cache";

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

// ─── Listening generation (Phase 3) ─────────────────────────────────────
export {
  createListeningGenerator,
  listeningGenerator,
} from "./generation/listening";
export type {
  GenerateListeningRequest,
  GenerateListeningResult,
  ListeningGeneratorDeps,
} from "./generation/listening";

export {
  generatedListeningSchema,
  parseGeneratedListening,
} from "./generation/listening-schema";
export type {
  GeneratedListening,
  GeneratedListeningCompletionBlock,
  GeneratedListeningPart,
  GeneratedListeningQuestion,
  GeneratedListeningSegment,
  GeneratedListeningSpeaker,
} from "./generation/listening-schema";

export { validateGeneratedListening } from "./generation/listening-validate";
export type {
  ListeningValidationIssue,
  ListeningValidationResult,
} from "./generation/listening-validate";

export {
  CLOSING_NARRATION,
  OPENING_NARRATION,
  persistGeneratedListening,
} from "./generation/listening-persist";
export type {
  PersistGeneratedListeningDb,
  PersistListeningResult,
} from "./generation/listening-persist";

// ─── Speaking generation ────────────────────────────────────────────────
export {
  createSpeakingGenerator,
  speakingGenerator,
} from "./generation/speaking";
export type {
  GenerateSpeakingRequest,
  GenerateSpeakingResult,
  SpeakingGeneratorDeps,
} from "./generation/speaking";

export {
  generatedSpeakingSchema,
  parseGeneratedSpeaking,
} from "./generation/speaking-schema";
export type {
  GeneratedSpeaking,
  GeneratedSpeakingPart1,
  GeneratedSpeakingPart2,
  GeneratedSpeakingPart3,
} from "./generation/speaking-schema";

export { validateGeneratedSpeaking } from "./generation/speaking-validate";
export type {
  SpeakingValidationIssue,
  SpeakingValidationResult,
} from "./generation/speaking-validate";

export { persistGeneratedSpeaking } from "./generation/speaking-persist";
export type {
  PersistGeneratedSpeakingDb,
  PersistSpeakingResult,
} from "./generation/speaking-persist";

// ─── Speaking examiner (realtime session instruction builder) ───────────
export {
  buildExaminerScript,
  loadExaminerPrompt,
} from "./speaking/examiner-prompt";
export type {
  ExaminerScript,
  ExaminerStageName,
  ExaminerStageConfig,
  ExaminerScriptContent,
  ExaminerTurnDetectionMode,
} from "./speaking/examiner-prompt";

// ─── Audio / transcript analysis (Phase 3) ──────────────────────────────
export { extractAudioFeatures } from "./audio/features";
export type {
  AudioFeatures,
  TranscriptSegment,
} from "./audio/features";

export { splitTranscriptByParts } from "./audio/split-transcript";
export type {
  PartRangeSec,
  PartTranscript,
  SplitTranscriptResult,
} from "./audio/split-transcript";
