"use client";

// Speaking practice runner — the live voice conversation with the AI examiner.
//
// Flow:
//   1. Learner clicks "Begin" → request mic + mint ephemeral OpenAI Realtime
//      token via `createRealtimeSession` → open WebRTC to api.openai.com.
//   2. Once the data channel is open, relay the per-stage examiner script
//      via `session.update` events at every IELTS transition. Server VAD is
//      on during Parts 1 / 2-followup / 3, and OFF during Part 2 prep + long
//      turn (the candidate's monologue stays uninterrupted).
//   3. The learner advances stages with explicit "Move to next part" buttons.
//      Phase 5 polish will make the examiner self-pace; v1 is learner-driven.
//   4. "End test" tears down WebRTC and marks the attempt Abandoned
//      (Phase 3 wires recording + transcription + Submitted/Graded).

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import type { ExaminerScript } from "@elc/ai";
import {
  createRealtimeSession,
  endSpeakingAttempt,
  type CreateRealtimeSessionResult,
} from "@/lib/speaking/actions";
import {
  renderCueCard,
  type SpeakingContent,
} from "@/lib/speaking/content";

type Stage =
  | "idle"
  | "connecting"
  | "part1"
  | "part2_prep"
  | "part2_long_turn"
  | "part2_followup"
  | "part3"
  | "ended"
  | "error";

// The five stages whose script the server returns; "idle"/"connecting"/
// "ended"/"error" are runner-only states.
type ScriptStage = Exclude<Stage, "idle" | "connecting" | "ended" | "error">;

const PART2_PREP_SECONDS = 60;

const STAGE_LABEL: Record<Stage, string> = {
  idle: "Ready to begin",
  connecting: "Connecting…",
  part1: "Part 1 — Interview",
  part2_prep: "Part 2 — Preparation (1 min)",
  part2_long_turn: "Part 2 — Long turn",
  part2_followup: "Part 2 — Follow-up",
  part3: "Part 3 — Discussion",
  ended: "Test complete",
  error: "Something went wrong",
};

const STAGE_INDEX: Record<ScriptStage, number> = {
  part1: 0,
  part2_prep: 1,
  part2_long_turn: 1,
  part2_followup: 1,
  part3: 2,
};

type Props = {
  attemptId: string;
  content: SpeakingContent;
  difficulty: number;
  startedAtIso: string;
};

export function SpeakingPractice({
  attemptId,
  content,
  difficulty,
  startedAtIso,
}: Props) {
  const [stage, setStage] = useState<Stage>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [prepRemaining, setPrepRemaining] = useState(PART2_PREP_SECONDS);
  const [examinerSpeaking, setExaminerSpeaking] = useState(false);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const scriptRef = useRef<ExaminerScript | null>(null);
  const prepTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Lifecycle ──────────────────────────────────────────────────────────

  useEffect(() => {
    // Cleanup on unmount: stop mic, close peer connection. We do NOT call
    // endSpeakingAttempt here — a navigation away is not the same as the
    // learner explicitly ending the test.
    return () => {
      teardownWebRTC();
    };
  }, []);

  function teardownWebRTC() {
    if (prepTimerRef.current) {
      clearInterval(prepTimerRef.current);
      prepTimerRef.current = null;
    }
    if (dcRef.current) {
      try {
        dcRef.current.close();
      } catch {
        /* noop */
      }
      dcRef.current = null;
    }
    if (pcRef.current) {
      try {
        pcRef.current.close();
      } catch {
        /* noop */
      }
      pcRef.current = null;
    }
    if (localStreamRef.current) {
      for (const t of localStreamRef.current.getTracks()) t.stop();
      localStreamRef.current = null;
    }
    if (audioRef.current) audioRef.current.srcObject = null;
    setExaminerSpeaking(false);
  }

  // ── Data-channel send helpers ──────────────────────────────────────────

  function sendStageUpdate(stageName: ScriptStage): void {
    const dc = dcRef.current;
    const script = scriptRef.current;
    if (!dc || dc.readyState !== "open" || !script) return;
    const cfg = script[stageName];
    dc.send(
      JSON.stringify({
        type: "session.update",
        session: {
          instructions: cfg.instructions,
          turn_detection:
            cfg.turn_detection === "server_vad" ? { type: "server_vad" } : null,
        },
      }),
    );
    if (cfg.examiner_opens) {
      dc.send(JSON.stringify({ type: "response.create" }));
    }
  }

  // ── Stage transitions ──────────────────────────────────────────────────

  async function begin() {
    setStage("connecting");
    setErrorMessage(null);

    let outcome: CreateRealtimeSessionResult;
    try {
      outcome = await createRealtimeSession(attemptId);
    } catch (err) {
      console.error("createRealtimeSession threw", err);
      setStage("error");
      setErrorMessage("Couldn't reach the server. Refresh and try again.");
      return;
    }
    if (!outcome.ok) {
      setStage("error");
      setErrorMessage(messageFor(outcome.error));
      return;
    }
    scriptRef.current = outcome.script;

    // Mic.
    let micStream: MediaStream;
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      console.error("getUserMedia failed", err);
      setStage("error");
      const name = err instanceof Error ? err.name : "";
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        setErrorMessage(
          "Microphone access was denied. Allow it in your browser settings and try again.",
        );
      } else if (name === "NotFoundError" || name === "DevicesNotFoundError") {
        setErrorMessage("No microphone was detected on this device.");
      } else {
        setErrorMessage("Couldn't open the microphone.");
      }
      return;
    }
    localStreamRef.current = micStream;

    // WebRTC.
    try {
      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      pc.ontrack = (e) => {
        const stream = e.streams[0];
        if (audioRef.current && stream) {
          audioRef.current.srcObject = stream;
        }
      };

      for (const t of micStream.getTracks()) pc.addTrack(t, micStream);

      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;
      dc.addEventListener("message", onDataChannelMessage);
      dc.addEventListener("open", () => {
        // Once the channel is open, push the Part 1 stage config and have
        // the examiner open the conversation.
        sendStageUpdate("part1");
        setStage("part1");
      });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const sdpResponse = await fetch(
        `https://api.openai.com/v1/realtime?model=${encodeURIComponent(outcome.model)}`,
        {
          method: "POST",
          body: offer.sdp,
          headers: {
            Authorization: `Bearer ${outcome.client_secret}`,
            "Content-Type": "application/sdp",
          },
        },
      );
      if (!sdpResponse.ok) {
        const detail = await sdpResponse.text().catch(() => "");
        throw new Error(
          `Realtime SDP exchange failed: ${sdpResponse.status} ${detail.slice(0, 200)}`,
        );
      }
      const answerSdp = await sdpResponse.text();
      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
    } catch (err) {
      console.error("WebRTC connect failed", err);
      teardownWebRTC();
      setStage("error");
      setErrorMessage(
        "Couldn't connect to the examiner. Check your network and try again.",
      );
    }
  }

  function onDataChannelMessage(e: MessageEvent<string>) {
    // Light-weight: just toggle the examiner-speaking indicator. We don't
    // act on individual events — the IELTS structure is driven by the
    // runner via session.update.
    let parsed: { type?: string } | null = null;
    try {
      parsed = JSON.parse(e.data) as { type?: string };
    } catch {
      return;
    }
    const t = parsed.type;
    if (t === "response.created" || t === "response.audio.delta") {
      setExaminerSpeaking(true);
    } else if (
      t === "response.done" ||
      t === "response.audio.done" ||
      t === "response.cancelled"
    ) {
      setExaminerSpeaking(false);
    }
  }

  function moveToPart2Prep() {
    setStage("part2_prep");
    sendStageUpdate("part2_prep");
    setPrepRemaining(PART2_PREP_SECONDS);
    if (prepTimerRef.current) clearInterval(prepTimerRef.current);
    prepTimerRef.current = setInterval(() => {
      setPrepRemaining((s) => {
        if (s <= 1) {
          if (prepTimerRef.current) {
            clearInterval(prepTimerRef.current);
            prepTimerRef.current = null;
          }
          // Auto-advance to the long turn.
          setStage("part2_long_turn");
          sendStageUpdate("part2_long_turn");
          return 0;
        }
        return s - 1;
      });
    }, 1000);
  }

  function startLongTurnEarly() {
    if (prepTimerRef.current) {
      clearInterval(prepTimerRef.current);
      prepTimerRef.current = null;
    }
    setPrepRemaining(0);
    setStage("part2_long_turn");
    sendStageUpdate("part2_long_turn");
  }

  function finishLongTurn() {
    setStage("part2_followup");
    sendStageUpdate("part2_followup");
  }

  function moveToPart3() {
    setStage("part3");
    sendStageUpdate("part3");
  }

  async function endTest() {
    teardownWebRTC();
    setStage("ended");
    const res = await endSpeakingAttempt(attemptId);
    if (!res.ok) {
      // We've already torn down the connection — surface the error but stay
      // on the ended screen.
      console.warn("endSpeakingAttempt failed", res.error);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────

  const stageIndex =
    stage === "part1" ||
    stage === "part2_prep" ||
    stage === "part2_long_turn" ||
    stage === "part2_followup" ||
    stage === "part3"
      ? STAGE_INDEX[stage as ScriptStage]
      : null;

  return (
    <div className="flex flex-col min-h-[calc(100vh-3.5rem)]">
      <audio ref={audioRef} autoPlay playsInline className="sr-only" />

      <Header
        stageLabel={STAGE_LABEL[stage]}
        stageIndex={stageIndex}
        startedAtIso={startedAtIso}
        difficulty={difficulty}
      />

      <main className="flex-1 mx-auto w-full max-w-5xl px-6 py-8">
        {stage === "idle" ? (
          <IdleView content={content} onBegin={begin} />
        ) : stage === "connecting" ? (
          <ConnectingView />
        ) : stage === "part1" ? (
          <Part1View
            content={content}
            examinerSpeaking={examinerSpeaking}
            onNext={moveToPart2Prep}
            onEnd={endTest}
          />
        ) : stage === "part2_prep" ? (
          <Part2PrepView
            content={content}
            secondsLeft={prepRemaining}
            onSkip={startLongTurnEarly}
            onEnd={endTest}
          />
        ) : stage === "part2_long_turn" ? (
          <Part2LongTurnView
            content={content}
            onFinish={finishLongTurn}
            onEnd={endTest}
          />
        ) : stage === "part2_followup" ? (
          <Part2FollowupView
            examinerSpeaking={examinerSpeaking}
            onNext={moveToPart3}
            onEnd={endTest}
          />
        ) : stage === "part3" ? (
          <Part3View
            content={content}
            examinerSpeaking={examinerSpeaking}
            onEnd={endTest}
          />
        ) : stage === "ended" ? (
          <EndedView />
        ) : (
          <ErrorView
            message={errorMessage}
            onRetry={() => {
              setStage("idle");
              setErrorMessage(null);
            }}
          />
        )}
      </main>
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────

function Header({
  stageLabel,
  stageIndex,
  startedAtIso,
  difficulty,
}: {
  stageLabel: string;
  stageIndex: number | null;
  startedAtIso: string;
  difficulty: number;
}) {
  const elapsed = useElapsed(startedAtIso);
  return (
    <div className="bg-brand-black text-white">
      <div className="mx-auto max-w-7xl px-6 py-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center rounded-pill bg-white text-brand-black font-heading font-bold text-xs px-3 py-1">
            Speaking
          </span>
          <span className="font-body text-sm text-brand-grey-200 hidden sm:inline">
            Difficulty {difficulty}/5 · {stageLabel}
          </span>
          <span className="font-body text-sm text-brand-grey-200 sm:hidden">
            {stageLabel}
          </span>
        </div>
        <div className="flex items-center gap-4">
          {stageIndex !== null ? (
            <PartDots active={stageIndex} />
          ) : null}
          <div
            className="font-heading font-bold text-xl tabular-nums text-white"
            aria-live="polite"
          >
            {formatElapsed(elapsed)}
          </div>
        </div>
      </div>
      <div className="h-1 bg-brand-red" aria-hidden="true" />
    </div>
  );
}

function PartDots({ active }: { active: number }) {
  return (
    <div className="flex items-center gap-1.5" aria-label={`Part ${active + 1} of 3`}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={
            "block w-2.5 h-2.5 rounded-full " +
            (i <= active ? "bg-brand-red" : "bg-brand-grey-700")
          }
        />
      ))}
    </div>
  );
}

function ExaminerIndicator({ speaking }: { speaking: boolean }) {
  return (
    <div className="flex items-center gap-3" aria-live="polite">
      <span
        className={
          "inline-flex items-center justify-center w-12 h-12 rounded-full " +
          (speaking
            ? "bg-brand-red animate-pulse"
            : "bg-brand-grey-200")
        }
        aria-hidden="true"
      >
        <span
          className={
            "block w-3 h-3 rounded-full " +
            (speaking ? "bg-white" : "bg-brand-grey-500")
          }
        />
      </span>
      <span className="font-body text-sm text-brand-grey-700">
        {speaking ? "Examiner speaking…" : "Your turn — speak naturally."}
      </span>
    </div>
  );
}

function PrimaryButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-pill bg-brand-red px-6 py-3 font-heading font-bold text-white border border-brand-red transition-colors hover:bg-brand-red-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2"
    >
      {children}
    </button>
  );
}

function SecondaryButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-pill bg-brand-black px-5 py-2.5 font-heading font-bold text-white transition-colors hover:bg-brand-grey-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2"
    >
      {children}
    </button>
  );
}

function Panel({ children }: { children: ReactNode }) {
  return (
    <section className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 p-6 space-y-4">
      {children}
    </section>
  );
}

// ─── Stage views ──────────────────────────────────────────────────────────

function IdleView({
  content,
  onBegin,
}: {
  content: SpeakingContent;
  onBegin: () => void;
}) {
  return (
    <div className="space-y-6">
      <Panel>
        <h2 className="font-display italic font-bold text-3xl text-brand-black leading-tight">
          {content.topic_domain}.
        </h2>
        <p className="font-body text-base text-brand-grey-700">
          You&apos;ll have a ~12-minute conversation with an AI examiner:
        </p>
        <ol className="font-body text-base text-brand-grey-900 leading-relaxed list-decimal pl-6 space-y-1">
          <li>
            <strong className="font-heading font-bold">Part 1 — Interview.</strong>{" "}
            A short, everyday-topics warm-up. About 4–5 minutes.
          </li>
          <li>
            <strong className="font-heading font-bold">Part 2 — Long turn.</strong>{" "}
            You&apos;ll get a cue card and one minute to prepare, then speak
            for 1–2 minutes uninterrupted.
          </li>
          <li>
            <strong className="font-heading font-bold">Part 3 — Discussion.</strong>{" "}
            A more abstract two-way discussion. About 4–5 minutes.
          </li>
        </ol>
        <p className="font-body text-sm text-brand-grey-600">
          Make sure you&apos;re in a quiet room. When you click <em>Begin</em>,
          your browser will ask for microphone access — accept it.
        </p>
        <div>
          <PrimaryButton onClick={onBegin}>Begin Speaking test</PrimaryButton>
        </div>
      </Panel>
    </div>
  );
}

function ConnectingView() {
  return (
    <Panel>
      <h2 className="font-heading font-bold text-xl text-brand-black">
        Connecting to the examiner…
      </h2>
      <p className="font-body text-base text-brand-grey-700">
        Setting up your microphone and the voice connection. This usually
        takes a couple of seconds.
      </p>
    </Panel>
  );
}

function Part1View({
  content,
  examinerSpeaking,
  onNext,
  onEnd,
}: {
  content: SpeakingContent;
  examinerSpeaking: boolean;
  onNext: () => void;
  onEnd: () => void;
}) {
  return (
    <div className="space-y-6">
      <Panel>
        <ExaminerIndicator speaking={examinerSpeaking} />
        <p className="font-body text-base text-brand-grey-700">
          The examiner is conducting Part 1 — short questions on familiar
          topics. Just answer naturally. The conversation runs ~4–5 minutes.
        </p>
        <div>
          <h3 className="font-heading font-bold text-sm uppercase tracking-wide text-brand-grey-600 mb-2">
            Today&apos;s Part 1 topics
          </h3>
          <ul className="flex flex-wrap gap-2">
            {content.part1.subtopics.map((s) => (
              <li
                key={s.topic}
                className="inline-flex items-center rounded-pill bg-brand-grey-100 px-3 py-1 font-body text-sm text-brand-grey-800"
              >
                {s.topic}
              </li>
            ))}
          </ul>
        </div>
      </Panel>
      <div className="flex flex-wrap gap-3 items-center">
        <PrimaryButton onClick={onNext}>Move to Part 2 →</PrimaryButton>
        <SecondaryButton onClick={onEnd}>End test</SecondaryButton>
      </div>
    </div>
  );
}

function Part2PrepView({
  content,
  secondsLeft,
  onSkip,
  onEnd,
}: {
  content: SpeakingContent;
  secondsLeft: number;
  onSkip: () => void;
  onEnd: () => void;
}) {
  return (
    <div className="space-y-6">
      <Panel>
        <div className="flex items-baseline justify-between gap-4 flex-wrap">
          <h2 className="font-heading font-bold text-xl text-brand-black">
            One minute to prepare
          </h2>
          <div
            className="font-display italic font-bold text-4xl text-brand-red tabular-nums"
            aria-live="polite"
          >
            0:{secondsLeft.toString().padStart(2, "0")}
          </div>
        </div>
        <p className="font-body text-base text-brand-grey-700">
          Read the cue card. Make a few mental notes. The examiner is silent
          during this minute.
        </p>
        <pre className="font-body text-base text-brand-grey-900 leading-relaxed whitespace-pre-wrap bg-brand-grey-50 rounded-md ring-1 ring-brand-grey-200 p-4">
          {renderCueCard(content.part2)}
        </pre>
      </Panel>
      <div className="flex flex-wrap gap-3 items-center">
        <PrimaryButton onClick={onSkip}>I&apos;m ready, start →</PrimaryButton>
        <SecondaryButton onClick={onEnd}>End test</SecondaryButton>
      </div>
    </div>
  );
}

function Part2LongTurnView({
  content,
  onFinish,
  onEnd,
}: {
  content: SpeakingContent;
  onFinish: () => void;
  onEnd: () => void;
}) {
  return (
    <div className="space-y-6">
      <Panel>
        <h2 className="font-heading font-bold text-xl text-brand-black">
          Speak for 1–2 minutes
        </h2>
        <p className="font-body text-base text-brand-grey-700">
          The examiner is listening and will not interrupt. Cover the points
          on the cue card and explain your reasons. Click{" "}
          <em>I&apos;ve finished</em> when you&apos;re done.
        </p>
        <pre className="font-body text-base text-brand-grey-900 leading-relaxed whitespace-pre-wrap bg-brand-grey-50 rounded-md ring-1 ring-brand-grey-200 p-4">
          {renderCueCard(content.part2)}
        </pre>
      </Panel>
      <div className="flex flex-wrap gap-3 items-center">
        <PrimaryButton onClick={onFinish}>I&apos;ve finished →</PrimaryButton>
        <SecondaryButton onClick={onEnd}>End test</SecondaryButton>
      </div>
    </div>
  );
}

function Part2FollowupView({
  examinerSpeaking,
  onNext,
  onEnd,
}: {
  examinerSpeaking: boolean;
  onNext: () => void;
  onEnd: () => void;
}) {
  return (
    <div className="space-y-6">
      <Panel>
        <ExaminerIndicator speaking={examinerSpeaking} />
        <p className="font-body text-base text-brand-grey-700">
          The examiner will ask one or two brief follow-up questions about
          what you just said. Answer in a sentence or two each.
        </p>
      </Panel>
      <div className="flex flex-wrap gap-3 items-center">
        <PrimaryButton onClick={onNext}>Move to Part 3 →</PrimaryButton>
        <SecondaryButton onClick={onEnd}>End test</SecondaryButton>
      </div>
    </div>
  );
}

function Part3View({
  content,
  examinerSpeaking,
  onEnd,
}: {
  content: SpeakingContent;
  examinerSpeaking: boolean;
  onEnd: () => void;
}) {
  return (
    <div className="space-y-6">
      <Panel>
        <ExaminerIndicator speaking={examinerSpeaking} />
        <p className="font-body text-base text-brand-grey-700">
          Part 3 is a discussion. The examiner will ask broader, more abstract
          questions about{" "}
          <strong className="font-heading font-bold">
            {content.part3.theme}
          </strong>
          . Take a moment to think before each answer — develop your reasons
          with examples.
        </p>
      </Panel>
      <div className="flex flex-wrap gap-3 items-center">
        <PrimaryButton onClick={onEnd}>End test →</PrimaryButton>
      </div>
    </div>
  );
}

function EndedView() {
  return (
    <Panel>
      <h2 className="font-display italic font-bold text-3xl text-brand-black leading-tight">
        Test complete.
      </h2>
      <p className="font-body text-base text-brand-grey-700">
        That&apos;s the end of your Speaking test. Recording capture,
        transcription, and AI grading land in the next release — for now the
        attempt is logged as completed without a band score.
      </p>
      <div>
        <Link
          href="/practice/speaking"
          className="inline-flex items-center rounded-pill bg-brand-red px-5 py-2.5 font-heading font-bold text-white border border-brand-red transition-colors hover:bg-brand-red-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2"
        >
          Back to Speaking practice
        </Link>
      </div>
    </Panel>
  );
}

function ErrorView({
  message,
  onRetry,
}: {
  message: string | null;
  onRetry: () => void;
}) {
  return (
    <Panel>
      <h2 className="font-heading font-bold text-xl text-brand-black">
        Something went wrong
      </h2>
      <p className="font-body text-base text-brand-grey-700">
        {message ?? "An unexpected error occurred."}
      </p>
      <div className="flex flex-wrap gap-3">
        <PrimaryButton onClick={onRetry}>Try again</PrimaryButton>
        <Link
          href="/practice/speaking"
          className="inline-flex items-center rounded-pill bg-brand-black px-5 py-2.5 font-heading font-bold text-white transition-colors hover:bg-brand-grey-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2"
        >
          Back to picker
        </Link>
      </div>
    </Panel>
  );
}

// ─── Tiny helpers ────────────────────────────────────────────────────────

function messageFor(
  error:
    | "not_found"
    | "wrong_status"
    | "no_content"
    | "quota"
    | "provider"
    | "unknown",
): string {
  switch (error) {
    case "not_found":
      return "This attempt isn't available. Start a fresh one from the picker.";
    case "wrong_status":
      return "This attempt has already ended. Start a fresh one from the picker.";
    case "no_content":
      return "This test's content is malformed. Please pick another test.";
    case "quota":
      return "You've reached your daily speaking quota. It resets at midnight UTC.";
    case "provider":
      return "The voice service is having a moment. Try again in a minute.";
    default:
      return "Something went wrong starting the session.";
  }
}

function useElapsed(startedAtIso: string): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return Math.max(0, now - new Date(startedAtIso).getTime());
}

function formatElapsed(ms: number): string {
  const sec = Math.floor(ms / 1000);
  const m = Math.floor(sec / 60)
    .toString()
    .padStart(2, "0");
  const s = (sec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}
