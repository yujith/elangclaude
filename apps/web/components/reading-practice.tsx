"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import type { CompletionBlock, ReadingPassage } from "@elc/ai";
import {
  autosaveReadingAnswer,
  submitReadingAttempt,
  type ClientResponsePayload,
} from "@/lib/reading/actions";

// ─── Shape the server shell sends us ─────────────────────────────────────
//
// `payload` is the *learner-safe* slice of the question — no correct_answer,
// no accepted-keys list. The server strips those before render. The grader
// recomputes correctness against the DB on submit.

export type RunnerMcq = {
  kind: "reading-mcq";
  options: { id: string; text: string }[];
};
export type RunnerTfng = { kind: "reading-true-false-not-given" };
export type RunnerYnng = { kind: "reading-yes-no-not-given" };
export type RunnerCompletion = {
  kind: "reading-sentence-completion";
  stem: string;
  word_limit: number;
};
export type RunnerMatchingHeadings = {
  kind: "reading-matching-headings";
  group_id: string;
  items: { key: string; text: string }[];
  allow_reuse: boolean;
};
export type RunnerMatchingFeatures = {
  kind: "reading-matching-features";
  group_id: string;
  items: { key: string; text: string }[];
  allow_reuse: boolean;
};
export type RunnerMatchingSentenceEndings = {
  kind: "reading-matching-sentence-endings";
  group_id: string;
  items: { key: string; text: string }[];
  allow_reuse: boolean;
};
export type RunnerMatchingInformation = {
  kind: "reading-matching-information";
  // Paragraph labels from the passage — the implicit "bank" for this type.
  paragraph_labels: string[];
};
export type RunnerShortAnswer = {
  kind: "reading-short-answer";
  word_limit: number;
};
export type RunnerCompletionBlank = {
  kind: "reading-completion-blank";
  block_id: string;
  slot_id: string;
  word_limit: number;
};

export type RunnerPayload =
  | RunnerMcq
  | RunnerTfng
  | RunnerYnng
  | RunnerCompletion
  | RunnerMatchingHeadings
  | RunnerMatchingFeatures
  | RunnerMatchingSentenceEndings
  | RunnerMatchingInformation
  | RunnerShortAnswer
  | RunnerCompletionBlank;

export type RunnerQuestion = {
  id: string;
  position: number;
  prompt: string;
  payload: RunnerPayload;
};

type Props = {
  attemptId: string;
  startedAtIso: string;
  passage: ReadingPassage;
  completionBlocks: CompletionBlock[];
  questions: RunnerQuestion[];
  initialResponses: Record<string, unknown>;
  // True when the question set references paragraph letters (matching-
  // headings, matching-information). Hides the A/B/C prefix for every
  // other question type per real IELTS convention.
  showParagraphLabels: boolean;
};

const SUGGESTED_MINUTES = 20;
const AUTOSAVE_DEBOUNCE_MS = 800;

type ResponsesMap = Record<string, ClientResponsePayload>;

function initialResponsesFor(
  questions: RunnerQuestion[],
  initial: Record<string, unknown>,
): ResponsesMap {
  const out: ResponsesMap = {};
  for (const q of questions) {
    const raw = initial[q.id];
    out[q.id] = blankFor(q.payload.kind, raw);
  }
  return out;
}

// Question kinds whose response payload carries `text` rather than
// `selected`. Keep this in lockstep with TEXT_KINDS in
// packages/ai/src/reading/question-types.ts — if it drifts, the runner
// crashes on autosave reload (as Phase 4's completion-blank did before
// short-answer/completion-blank were added here).
const TEXT_RESPONSE_KINDS: ReadonlySet<RunnerPayload["kind"]> = new Set([
  "reading-sentence-completion",
  "reading-short-answer",
  "reading-completion-blank",
]);

function blankFor(
  kind: RunnerPayload["kind"],
  raw: unknown,
): ClientResponsePayload {
  const isTextKind = TEXT_RESPONSE_KINDS.has(kind);
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const r = raw as { kind?: string; selected?: unknown; text?: unknown };
    if (r.kind === kind) {
      if (isTextKind) {
        return {
          kind,
          text: typeof r.text === "string" ? r.text : "",
        } as ClientResponsePayload;
      }
      return {
        kind,
        selected: typeof r.selected === "string" ? r.selected : null,
      } as ClientResponsePayload;
    }
  }
  if (isTextKind) return { kind, text: "" } as ClientResponsePayload;
  return { kind, selected: null } as ClientResponsePayload;
}

type DisplayItem =
  | { kind: "question"; question: RunnerQuestion; questionNumber: number }
  | {
      kind: "completion-block";
      block: CompletionBlock;
      // slot_id → { questionId, questionNumber } for every blank in the
      // block that has a corresponding question.
      slots: Map<string, { questionId: string; questionNumber: number }>;
      questionRange: { from: number; to: number };
    };

function buildDisplayItems(
  questions: RunnerQuestion[],
  blocksById: Map<string, CompletionBlock>,
): DisplayItem[] {
  const items: DisplayItem[] = [];
  let i = 0;
  while (i < questions.length) {
    const q = questions[i]!;
    const questionNumber = i + 1;
    if (q.payload.kind === "reading-completion-blank") {
      const blockId = q.payload.block_id;
      const block = blocksById.get(blockId);
      if (!block) {
        // No matching block on the passage — fall back to rendering this
        // question on its own. Defensive; the server projects only when
        // the block exists.
        items.push({ kind: "question", question: q, questionNumber });
        i++;
        continue;
      }
      const slots = new Map<
        string,
        { questionId: string; questionNumber: number }
      >();
      const from = questionNumber;
      let to = from;
      let j = i;
      while (j < questions.length) {
        const qj = questions[j]!;
        if (
          qj.payload.kind !== "reading-completion-blank" ||
          qj.payload.block_id !== blockId
        ) {
          break;
        }
        slots.set(qj.payload.slot_id, {
          questionId: qj.id,
          questionNumber: j + 1,
        });
        to = j + 1;
        j++;
      }
      items.push({
        kind: "completion-block",
        block,
        slots,
        questionRange: { from, to },
      });
      i = j;
    } else {
      items.push({ kind: "question", question: q, questionNumber });
      i++;
    }
  }
  return items;
}

export function ReadingPractice({
  attemptId,
  startedAtIso,
  passage,
  completionBlocks,
  questions,
  initialResponses,
  showParagraphLabels,
}: Props) {
  const [responses, setResponses] = useState<ResponsesMap>(() =>
    initialResponsesFor(questions, initialResponses),
  );
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  const [savedAt, setSavedAt] = useState<string | null>(null);

  // Single-flight autosave per question — the latest debounced payload for
  // each question lands in pendingByQ; when the in-flight save resolves we
  // drain whatever's queued.
  const inFlightRef = useRef<Set<string>>(new Set());
  const pendingByQ = useRef<Record<string, ClientResponsePayload>>({});
  const timersByQ = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  async function flush(questionId: string, payload: ClientResponsePayload) {
    if (inFlightRef.current.has(questionId)) {
      pendingByQ.current[questionId] = payload;
      return;
    }
    inFlightRef.current.add(questionId);
    setSaveStatus("saving");
    try {
      const res = await autosaveReadingAnswer(attemptId, questionId, payload);
      if (res.ok) {
        setSavedAt(res.savedAt);
        setSaveStatus("saved");
      } else {
        setSaveStatus("error");
      }
    } catch {
      setSaveStatus("error");
    } finally {
      inFlightRef.current.delete(questionId);
      const queued = pendingByQ.current[questionId];
      if (queued) {
        delete pendingByQ.current[questionId];
        void flush(questionId, queued);
      }
    }
  }

  function onChange(questionId: string, payload: ClientResponsePayload) {
    setResponses((prev) => ({ ...prev, [questionId]: payload }));
    const existing = timersByQ.current[questionId];
    if (existing) clearTimeout(existing);
    timersByQ.current[questionId] = setTimeout(() => {
      void flush(questionId, payload);
    }, AUTOSAVE_DEBOUNCE_MS);
  }

  // Clear any pending autosave timers on unmount. Copy the ref into a local
  // so the cleanup closure doesn't observe a mutated ref.current later.
  useEffect(() => {
    const timers = timersByQ.current;
    return () => {
      for (const id of Object.keys(timers)) {
        const t = timers[id];
        if (t) clearTimeout(t);
      }
    };
  }, []);

  const elapsedMs = useElapsed(startedAtIso);
  const remainingMs = SUGGESTED_MINUTES * 60_000 - elapsedMs;
  const overTime = remainingMs <= 0;

  const answeredCount = questions.reduce((n, q) => {
    const r = responses[q.id];
    if (!r) return n;
    if (
      r.kind === "reading-sentence-completion" ||
      r.kind === "reading-short-answer" ||
      r.kind === "reading-completion-blank"
    ) {
      return r.text.trim().length > 0 ? n + 1 : n;
    }
    return r.selected ? n + 1 : n;
  }, 0);

  const blocksById = new Map(completionBlocks.map((b) => [b.id, b]));
  const displayItems = buildDisplayItems(questions, blocksById);

  return (
    <div className="flex flex-col">
      <div className="bg-brand-black text-white">
        <div className="mx-auto max-w-7xl px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center rounded-pill bg-white text-brand-black font-heading font-bold text-xs px-3 py-1">
              Reading
            </span>
            <span className="font-body text-sm text-brand-grey-200 hidden sm:inline">
              {answeredCount} of {questions.length} answered · suggested{" "}
              {SUGGESTED_MINUTES} min
            </span>
          </div>
          <div className="flex items-center gap-4">
            <div
              className={
                "font-heading font-bold text-2xl tabular-nums " +
                (overTime ? "text-brand-red" : "text-white")
              }
              aria-live="polite"
            >
              {formatRemaining(remainingMs)}
            </div>
          </div>
        </div>
        <div className="h-1 bg-brand-red" aria-hidden="true" />
      </div>

      <div className="mx-auto w-full max-w-7xl px-6 py-6 grid grid-cols-1 lg:grid-cols-[1fr_1.1fr] gap-6">
        <section
          aria-label="Passage"
          className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 p-6 max-h-[75vh] overflow-y-auto"
        >
          {passage.title ? (
            <h2 className="font-heading font-bold text-2xl text-brand-black mb-4">
              {passage.title}
            </h2>
          ) : null}
          <div className="space-y-4">
            {passage.paragraphs.map((p) => (
              <p
                key={p.label}
                className="font-body text-base text-brand-grey-900 leading-relaxed"
              >
                {showParagraphLabels ? (
                  <span className="font-heading font-bold text-brand-red mr-2">
                    {p.label}
                  </span>
                ) : null}
                {p.text}
              </p>
            ))}
          </div>
        </section>

        <form
          action={submitReadingAttempt}
          className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 p-6 flex flex-col"
        >
          <input type="hidden" name="attemptId" value={attemptId} />
          <h2 className="font-heading font-bold text-xl text-brand-black mb-1">
            Questions
          </h2>
          <p className="font-body text-sm text-brand-grey-700 mb-4">
            Your answers autosave as you go.
          </p>

          <ol className="space-y-6">
            {displayItems.map((item, idx) => {
              if (item.kind === "question") {
                return (
                  <li
                    key={item.question.id}
                    className="border-t border-brand-grey-200 pt-5 first:border-t-0 first:pt-0"
                  >
                    <QuestionRow
                      index={item.questionNumber}
                      question={item.question}
                      value={responses[item.question.id]}
                      onChange={(p) => onChange(item.question.id, p)}
                    />
                  </li>
                );
              }
              return (
                <li
                  key={`block-${item.block.id}-${idx}`}
                  className="border-t border-brand-grey-200 pt-5 first:border-t-0 first:pt-0"
                >
                  <CompletionBlockPanel
                    block={item.block}
                    slots={item.slots}
                    questionRange={item.questionRange}
                    responses={responses}
                    onChange={onChange}
                  />
                </li>
              );
            })}
          </ol>

          <div className="mt-6 flex items-center justify-between gap-3 text-sm font-body text-brand-grey-700">
            <SaveIndicator status={saveStatus} savedAt={savedAt} />
            <SubmitButton />
          </div>
        </form>
      </div>
    </div>
  );
}

function QuestionRow({
  index,
  question,
  value,
  onChange,
}: {
  index: number;
  question: RunnerQuestion;
  value: ClientResponsePayload | undefined;
  onChange: (p: ClientResponsePayload) => void;
}) {
  const labelId = `q-${question.id}-label`;
  return (
    <div>
      <p id={labelId} className="font-heading font-bold text-base text-brand-black mb-2">
        <span className="text-brand-red mr-2">{index}.</span>
        <span className="whitespace-pre-wrap">{question.prompt}</span>
      </p>
      {renderInput(question, value, onChange)}
    </div>
  );
}

function renderInput(
  question: RunnerQuestion,
  value: ClientResponsePayload | undefined,
  onChange: (p: ClientResponsePayload) => void,
) {
  const selectedFor = (
    v: ClientResponsePayload | undefined,
  ): string | null => {
    if (!v) return null;
    if (
      v.kind === "reading-sentence-completion" ||
      v.kind === "reading-short-answer" ||
      v.kind === "reading-completion-blank"
    ) {
      return null;
    }
    return v.selected ?? null;
  };
  switch (question.payload.kind) {
    case "reading-mcq":
      return (
        <McqInput
          questionId={question.id}
          options={question.payload.options}
          value={selectedFor(value)}
          onChange={(selected) => onChange({ kind: "reading-mcq", selected })}
        />
      );
    case "reading-true-false-not-given":
      return (
        <ChoiceInput
          name={`q-${question.id}`}
          labels={["true", "false", "not given"]}
          displayLabels={["True", "False", "Not Given"]}
          value={selectedFor(value)}
          onChange={(selected) =>
            onChange({ kind: "reading-true-false-not-given", selected })
          }
        />
      );
    case "reading-yes-no-not-given":
      return (
        <ChoiceInput
          name={`q-${question.id}`}
          labels={["yes", "no", "not given"]}
          displayLabels={["Yes", "No", "Not Given"]}
          value={selectedFor(value)}
          onChange={(selected) =>
            onChange({ kind: "reading-yes-no-not-given", selected })
          }
        />
      );
    case "reading-sentence-completion":
      return (
        <CompletionInput
          stem={question.payload.stem}
          wordLimit={question.payload.word_limit}
          value={
            value && value.kind === "reading-sentence-completion"
              ? value.text
              : ""
          }
          onChange={(text) =>
            onChange({ kind: "reading-sentence-completion", text })
          }
        />
      );
    case "reading-matching-headings":
    case "reading-matching-features":
    case "reading-matching-sentence-endings":
      return (
        <BankSelectInput
          questionId={question.id}
          items={question.payload.items}
          allowReuse={question.payload.allow_reuse}
          value={selectedFor(value)}
          onChange={(selected) =>
            onChange({ kind: question.payload.kind, selected } as ClientResponsePayload)
          }
        />
      );
    case "reading-matching-information":
      return (
        <ParagraphSelectInput
          questionId={question.id}
          paragraphLabels={question.payload.paragraph_labels}
          value={selectedFor(value)}
          onChange={(selected) =>
            onChange({ kind: "reading-matching-information", selected })
          }
        />
      );
    case "reading-short-answer":
      return (
        <ShortAnswerInput
          questionId={question.id}
          wordLimit={question.payload.word_limit}
          value={
            value && value.kind === "reading-short-answer" ? value.text : ""
          }
          onChange={(text) => onChange({ kind: "reading-short-answer", text })}
        />
      );
    case "reading-completion-blank":
      // Completion-blank questions are rendered inside their CompletionBlockPanel,
      // not as a standalone row. If we ever reach here, fall back to a
      // text input so the learner is never blocked.
      return (
        <ShortAnswerInput
          questionId={question.id}
          wordLimit={question.payload.word_limit}
          value={
            value && value.kind === "reading-completion-blank" ? value.text : ""
          }
          onChange={(text) =>
            onChange({ kind: "reading-completion-blank", text })
          }
        />
      );
  }
}

function McqInput({
  questionId,
  options,
  value,
  onChange,
}: {
  questionId: string;
  options: { id: string; text: string }[];
  value: string | null;
  onChange: (id: string) => void;
}) {
  return (
    <fieldset className="mt-1">
      <legend className="sr-only">Choose one option</legend>
      <div className="space-y-2">
        {options.map((o) => {
          const id = `q-${questionId}-${o.id}`;
          return (
            <label
              key={o.id}
              htmlFor={id}
              className="flex items-start gap-3 rounded-md ring-1 ring-brand-grey-200 px-3 py-2 cursor-pointer hover:bg-brand-grey-50 has-[:checked]:ring-brand-red has-[:checked]:bg-brand-red-soft"
            >
              <input
                id={id}
                type="radio"
                name={`q-${questionId}`}
                value={o.id}
                checked={value === o.id}
                onChange={() => onChange(o.id)}
                className="mt-1 accent-brand-red"
              />
              <span className="font-body text-sm text-brand-grey-900 leading-relaxed">
                <span className="font-heading font-bold mr-2">{o.id}.</span>
                {o.text}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function ChoiceInput({
  name,
  labels,
  displayLabels,
  value,
  onChange,
}: {
  name: string;
  labels: string[];
  displayLabels: string[];
  value: string | null;
  onChange: (v: string) => void;
}) {
  return (
    <fieldset className="mt-1">
      <legend className="sr-only">Choose one</legend>
      <div className="flex flex-wrap gap-2">
        {labels.map((l, i) => {
          const id = `${name}-${l}`;
          return (
            <label
              key={l}
              htmlFor={id}
              className="inline-flex items-center gap-2 rounded-pill ring-1 ring-brand-grey-200 px-4 py-2 cursor-pointer hover:bg-brand-grey-50 has-[:checked]:ring-brand-red has-[:checked]:bg-brand-red-soft"
            >
              <input
                id={id}
                type="radio"
                name={name}
                value={l}
                checked={value === l}
                onChange={() => onChange(l)}
                className="accent-brand-red"
              />
              <span className="font-heading font-bold text-sm text-brand-grey-900">
                {displayLabels[i]}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function BankSelectInput({
  questionId,
  items,
  allowReuse,
  value,
  onChange,
}: {
  questionId: string;
  items: { key: string; text: string }[];
  allowReuse: boolean;
  value: string | null;
  onChange: (key: string | null) => void;
}) {
  const selectId = `q-${questionId}-bank-select`;
  return (
    <div className="mt-1 space-y-3">
      <details className="rounded-md ring-1 ring-brand-grey-200 px-3 py-2 bg-brand-grey-50">
        <summary className="cursor-pointer font-heading font-bold text-xs uppercase tracking-wide text-brand-grey-600 select-none">
          Bank ({items.length} options
          {allowReuse ? " — letters may be used more than once" : ""})
        </summary>
        <ul className="mt-2 space-y-1.5">
          {items.map((it) => (
            <li
              key={it.key}
              className="font-body text-sm text-brand-grey-900 leading-snug"
            >
              <span className="font-heading font-bold text-brand-red mr-2">
                {it.key}
              </span>
              {it.text}
            </li>
          ))}
        </ul>
      </details>
      <div>
        <label
          htmlFor={selectId}
          className="font-body text-xs uppercase tracking-wide text-brand-grey-500 block mb-1"
        >
          Your answer
        </label>
        <select
          id={selectId}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
          className="rounded-md ring-1 ring-brand-grey-300 bg-white px-3 py-2 font-body text-sm text-brand-grey-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red"
        >
          <option value="">— pick one —</option>
          {items.map((it) => (
            <option key={it.key} value={it.key}>
              {it.key} — {truncate(it.text, 80)}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function ParagraphSelectInput({
  questionId,
  paragraphLabels,
  value,
  onChange,
}: {
  questionId: string;
  paragraphLabels: string[];
  value: string | null;
  onChange: (label: string | null) => void;
}) {
  const selectId = `q-${questionId}-para-select`;
  return (
    <div className="mt-1">
      <label
        htmlFor={selectId}
        className="font-body text-xs uppercase tracking-wide text-brand-grey-500 block mb-1"
      >
        Pick a paragraph
      </label>
      <select
        id={selectId}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
        className="rounded-md ring-1 ring-brand-grey-300 bg-white px-3 py-2 font-body text-sm text-brand-grey-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red"
      >
        <option value="">— pick one —</option>
        {paragraphLabels.map((label) => (
          <option key={label} value={label}>
            Paragraph {label}
          </option>
        ))}
      </select>
    </div>
  );
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}

function ShortAnswerInput({
  questionId,
  wordLimit,
  value,
  onChange,
}: {
  questionId: string;
  wordLimit: number;
  value: string;
  onChange: (v: string) => void;
}) {
  const wc = value.trim().split(/\s+/).filter(Boolean).length;
  const over = wc > wordLimit;
  const inputId = `q-${questionId}-short-answer`;
  return (
    <div className="mt-2 space-y-2">
      <label htmlFor={inputId} className="sr-only">
        Your answer
      </label>
      <input
        id={inputId}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Type your answer"
        className="w-full max-w-md rounded-md ring-1 ring-brand-grey-300 px-3 py-2 font-body text-sm text-brand-grey-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red"
      />
      <p
        className={
          "font-body text-xs " +
          (over ? "text-brand-red" : "text-brand-grey-500")
        }
      >
        {wc}/{wordLimit} words
        {over ? " — over the limit" : ""}
      </p>
    </div>
  );
}

// ─── Completion block panel + per-layout renderers ──────────────────────
//
// A completion block (summary / notes / table / flow-chart / diagram)
// renders once with all of its blanks inline. Each blank is an <input/>
// bound to the corresponding reading-completion-blank question by
// (block_id, slot_id). The grader sees per-question Answer rows; the
// learner sees a single coherent block.

function CompletionBlockPanel({
  block,
  slots,
  questionRange,
  responses,
  onChange,
}: {
  block: CompletionBlock;
  slots: Map<string, { questionId: string; questionNumber: number }>;
  questionRange: { from: number; to: number };
  responses: Record<string, ClientResponsePayload>;
  onChange: (questionId: string, p: ClientResponsePayload) => void;
}) {
  const blankInput = (slotId: string) => {
    const slot = slots.get(slotId);
    if (!slot) {
      // Block declares a blank but no question references it — render an
      // inert placeholder so the layout still makes sense.
      return (
        <span className="inline-block min-w-[6ch] border-b-2 border-brand-grey-300 mx-1 text-brand-grey-400 align-baseline">
          ___
        </span>
      );
    }
    const r = responses[slot.questionId];
    const value =
      r && r.kind === "reading-completion-blank" ? r.text : "";
    return (
      <BlankInput
        slotId={slotId}
        questionNumber={slot.questionNumber}
        value={value}
        onChange={(text) =>
          onChange(slot.questionId, {
            kind: "reading-completion-blank",
            text,
          })
        }
      />
    );
  };

  const rangeLabel =
    questionRange.from === questionRange.to
      ? `Question ${questionRange.from}`
      : `Questions ${questionRange.from}–${questionRange.to}`;

  return (
    <section
      aria-labelledby={`block-${block.id}-title`}
      className="rounded-lg ring-1 ring-brand-grey-200 bg-brand-grey-50 p-5"
    >
      <header className="mb-3">
        <p className="font-body text-xs uppercase tracking-widest text-brand-red">
          {rangeLabel} · {layoutLabel(block.layout)}
        </p>
        <h3
          id={`block-${block.id}-title`}
          className="mt-1 font-heading font-bold text-lg text-brand-black"
        >
          {block.title ?? layoutLabel(block.layout)}
        </h3>
        {block.instructions ? (
          <p className="mt-1 font-body text-sm text-brand-grey-700">
            {block.instructions}
          </p>
        ) : null}
      </header>
      <CompletionLayoutBody block={block} renderBlank={blankInput} />
    </section>
  );
}

function layoutLabel(layout: CompletionBlock["layout"]): string {
  switch (layout) {
    case "summary":
      return "Summary completion";
    case "notes":
      return "Note completion";
    case "table":
      return "Table completion";
    case "flow-chart":
      return "Flow-chart completion";
    case "diagram":
      return "Diagram-label completion";
  }
}

function BlankInput({
  slotId,
  questionNumber,
  value,
  onChange,
}: {
  slotId: string;
  questionNumber: number;
  value: string;
  onChange: (text: string) => void;
}) {
  const wc = value.trim().split(/\s+/).filter(Boolean).length;
  return (
    <span className="inline-flex items-center gap-1 mx-1 align-baseline">
      <span
        aria-hidden
        className="font-heading font-bold text-xs text-brand-red"
      >
        {questionNumber}
      </span>
      <input
        type="text"
        value={value}
        aria-label={`Question ${questionNumber} answer`}
        onChange={(e) => onChange(e.target.value)}
        className="inline-block min-w-[10ch] rounded-md ring-1 ring-brand-grey-300 bg-white px-2 py-0.5 font-body text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red"
        data-slot-id={slotId}
      />
      {wc > 0 ? (
        <span className="font-body text-[10px] text-brand-grey-500 tabular-nums">
          {wc}
        </span>
      ) : null}
    </span>
  );
}

function CompletionLayoutBody({
  block,
  renderBlank,
}: {
  block: CompletionBlock;
  renderBlank: (slotId: string) => React.ReactNode;
}) {
  switch (block.layout) {
    case "summary":
      return <SummaryLayout block={block} renderBlank={renderBlank} />;
    case "notes":
      return <NotesLayout block={block} renderBlank={renderBlank} />;
    case "table":
      return <TableLayout block={block} renderBlank={renderBlank} />;
    case "flow-chart":
      return <FlowChartLayout block={block} renderBlank={renderBlank} />;
    case "diagram":
      return <DiagramLayout block={block} renderBlank={renderBlank} />;
  }
}

function renderSegments(
  segments: { kind: "text" | "blank"; text?: string; slot_id?: string }[],
  renderBlank: (slotId: string) => React.ReactNode,
): React.ReactNode {
  return segments.map((seg, i) => {
    if (seg.kind === "text") {
      return <span key={`t-${i}`}>{seg.text ?? ""}</span>;
    }
    if (!seg.slot_id) return null;
    return (
      <span key={`b-${seg.slot_id}`} className="contents">
        {renderBlank(seg.slot_id)}
      </span>
    );
  });
}

function SummaryLayout({
  block,
  renderBlank,
}: {
  block: CompletionBlock;
  renderBlank: (slotId: string) => React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-md ring-1 ring-brand-grey-200 p-4">
      {block.rows.map((row, i) => (
        <p
          key={`row-${i}`}
          className="font-body text-sm text-brand-grey-900 leading-relaxed"
        >
          {row.cells.flatMap((cell, ci) => (
            <span key={`cell-${ci}`}>{renderSegments(cell, renderBlank)}</span>
          ))}
        </p>
      ))}
    </div>
  );
}

function NotesLayout({
  block,
  renderBlank,
}: {
  block: CompletionBlock;
  renderBlank: (slotId: string) => React.ReactNode;
}) {
  return (
    <ul className="bg-white rounded-md ring-1 ring-brand-grey-200 p-4 space-y-2">
      {block.rows.map((row, i) => (
        <li
          key={`row-${i}`}
          className="font-body text-sm text-brand-grey-900 leading-relaxed flex flex-wrap items-baseline gap-2"
        >
          {row.label ? (
            <span className="font-heading font-bold text-brand-black">
              {row.label}
            </span>
          ) : (
            <span aria-hidden className="text-brand-red">
              •
            </span>
          )}
          <span>
            {row.cells.flatMap((cell, ci) => (
              <span key={`cell-${ci}`}>
                {renderSegments(cell, renderBlank)}
              </span>
            ))}
          </span>
        </li>
      ))}
    </ul>
  );
}

function TableLayout({
  block,
  renderBlank,
}: {
  block: CompletionBlock;
  renderBlank: (slotId: string) => React.ReactNode;
}) {
  const header = block.rows.find((r) => r.is_header);
  const body = block.rows.filter((r) => !r.is_header);
  return (
    <div className="overflow-x-auto bg-white rounded-md ring-1 ring-brand-grey-200">
      <table className="w-full text-left">
        {header ? (
          <thead className="bg-brand-grey-100">
            <tr>
              {header.cells.map((cell, ci) => (
                <th
                  key={`h-${ci}`}
                  className="font-heading font-bold text-xs uppercase tracking-wide text-brand-grey-700 px-3 py-2"
                >
                  {renderSegments(cell, renderBlank)}
                </th>
              ))}
            </tr>
          </thead>
        ) : null}
        <tbody>
          {body.map((row, ri) => (
            <tr key={`r-${ri}`} className="border-t border-brand-grey-200">
              {row.cells.map((cell, ci) => (
                <td
                  key={`c-${ri}-${ci}`}
                  className="font-body text-sm text-brand-grey-900 px-3 py-2 align-top"
                >
                  {renderSegments(cell, renderBlank)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FlowChartLayout({
  block,
  renderBlank,
}: {
  block: CompletionBlock;
  renderBlank: (slotId: string) => React.ReactNode;
}) {
  return (
    <ol className="space-y-3">
      {block.rows.map((row, i) => (
        <li
          key={`row-${i}`}
          className="bg-white rounded-md ring-1 ring-brand-grey-200 p-3 flex items-start gap-3"
        >
          <span className="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-full bg-brand-red text-white font-heading font-bold text-sm">
            {row.label ?? i + 1}
          </span>
          <p className="font-body text-sm text-brand-grey-900 leading-relaxed pt-1">
            {row.cells.flatMap((cell, ci) => (
              <span key={`cell-${ci}`}>{renderSegments(cell, renderBlank)}</span>
            ))}
          </p>
        </li>
      ))}
    </ol>
  );
}

function DiagramLayout({
  block,
  renderBlank,
}: {
  block: CompletionBlock;
  renderBlank: (slotId: string) => React.ReactNode;
}) {
  // v1 simplification: a labelled diagram is rendered as a stack of callout
  // cards, each with a `label` (the area) and the descriptive text + blank
  // inputs. A real pixel-anchored diagram is a Phase-6 follow-up.
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {block.rows.map((row, i) => (
        <div
          key={`row-${i}`}
          className="bg-white rounded-md ring-1 ring-brand-grey-200 p-3"
        >
          {row.label ? (
            <p className="font-heading font-bold text-xs uppercase tracking-wide text-brand-grey-500 mb-1">
              {row.label}
            </p>
          ) : null}
          <p className="font-body text-sm text-brand-grey-900 leading-relaxed">
            {row.cells.flatMap((cell, ci) => (
              <span key={`cell-${ci}`}>{renderSegments(cell, renderBlank)}</span>
            ))}
          </p>
        </div>
      ))}
    </div>
  );
}

function CompletionInput({
  stem,
  wordLimit,
  value,
  onChange,
}: {
  stem: string;
  wordLimit: number;
  value: string;
  onChange: (v: string) => void;
}) {
  const [before, after] = stem.split("___");
  const wc = value.trim().split(/\s+/).filter(Boolean).length;
  const over = wc > wordLimit;
  return (
    <div className="mt-2 space-y-2">
      <p className="font-body text-sm text-brand-grey-900 leading-relaxed">
        {before}
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label="Your answer"
          className="mx-1 inline-block min-w-[10ch] rounded-md ring-1 ring-brand-grey-300 px-2 py-1 font-body text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red"
        />
        {after}
      </p>
      <p
        className={
          "font-body text-xs " +
          (over ? "text-brand-red" : "text-brand-grey-500")
        }
      >
        {wc}/{wordLimit} words
        {over ? " — over the limit" : ""}
      </p>
    </div>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center gap-2 rounded-pill bg-brand-red px-6 py-3 font-heading font-bold text-white border border-brand-red transition-colors hover:bg-brand-red-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed"
    >
      {pending ? "Submitting…" : "Submit answers"}
    </button>
  );
}

function SaveIndicator({
  status,
  savedAt,
}: {
  status: "idle" | "saving" | "saved" | "error";
  savedAt: string | null;
}) {
  if (status === "saving") {
    return (
      <span className="text-brand-grey-500">
        <span className="inline-block w-2 h-2 rounded-full bg-brand-grey-400 animate-pulse mr-2 align-middle" />
        Saving…
      </span>
    );
  }
  if (status === "error") {
    return <span className="text-brand-red">Couldn&apos;t save — keep going</span>;
  }
  if (status === "saved") {
    const ago = savedAt ? agoString(savedAt) : "just now";
    return <span className="text-brand-grey-500">Saved {ago}</span>;
  }
  return <span className="text-brand-grey-500">Draft</span>;
}

function useElapsed(startedAtIso: string): number {
  const [elapsed, setElapsed] = useState(() =>
    Math.max(0, Date.now() - new Date(startedAtIso).getTime()),
  );
  useEffect(() => {
    const id = setInterval(() => {
      setElapsed(Math.max(0, Date.now() - new Date(startedAtIso).getTime()));
    }, 1000);
    return () => clearInterval(id);
  }, [startedAtIso]);
  return elapsed;
}

function formatRemaining(ms: number): string {
  const absSec = Math.max(0, Math.floor(Math.abs(ms) / 1000));
  const mm = Math.floor(absSec / 60).toString().padStart(2, "0");
  const ss = (absSec % 60).toString().padStart(2, "0");
  const sign = ms < 0 ? "-" : "";
  return `${sign}${mm}:${ss}`;
}

function agoString(savedAtIso: string): string {
  const seconds = Math.max(
    0,
    Math.round((Date.now() - new Date(savedAtIso).getTime()) / 1000),
  );
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return `${hours}h ago`;
}
