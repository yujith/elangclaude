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
import { useRouter } from "next/navigation";
import type { ExaminerScript } from "@elc/ai";
import {
  createRealtimeSession,
  endSpeakingAttempt,
  finalizeSpeakingAttempt,
  requestRecordingUpload,
  type CreateRealtimeSessionResult,
  type StageBoundariesMs,
} from "@/lib/speaking/actions";
import {
  renderCueCard,
  type SpeakingContent,
} from "@/lib/speaking/content";

type Stage =
  | "idle"
  | "connecting"
  | "part1"
  | "part2_intro"
  | "part2_prep"
  | "part2_long_turn"
  | "part2_followup"
  | "part3"
  | "uploading"
  | "finalizing"
  | "ended"
  | "submit_error"
  | "error";

// The six script-driven stages whose instructions the server returns;
// everything else is a runner-only state.
type ScriptStage = Extract<
  Stage,
  | "part1"
  | "part2_intro"
  | "part2_prep"
  | "part2_long_turn"
  | "part2_followup"
  | "part3"
>;

const PART2_PREP_SECONDS = 60;
// If the examiner's intro hand-off doesn't end (response.done never fires)
// within this window, the runner advances to the silent prep minute
// anyway. The hand-off itself is normally ~12–15s.
const PART2_INTRO_SAFETY_MS = 25_000;

// Tuned `server_vad` parameters for the IELTS conversation feel:
//   - threshold:           a hair above OpenAI's default so background mic
//                          noise / breaths don't false-trigger a turn end.
//   - prefix_padding_ms:   include 300 ms before the detected speech start
//                          so the leading "Um, well…" isn't cut off.
//   - silence_duration_ms: wait 700 ms of silence before declaring the
//                          candidate's turn done — gives them a beat to
//                          finish a thought without the examiner cutting in.
const VAD_CONFIG = {
  type: "server_vad" as const,
  threshold: 0.55,
  prefix_padding_ms: 300,
  silence_duration_ms: 700,
};

const STAGE_LABEL: Record<Stage, string> = {
  idle: "Ready to begin",
  connecting: "Connecting…",
  part1: "Part 1 — Interview",
  part2_intro: "Part 2 — Hand-off",
  part2_prep: "Part 2 — Preparation (1 min)",
  part2_long_turn: "Part 2 — Long turn",
  part2_followup: "Part 2 — Follow-up",
  part3: "Part 3 — Discussion",
  uploading: "Uploading your recording…",
  finalizing: "Transcribing your conversation…",
  ended: "Test complete",
  submit_error: "Submission failed",
  error: "Something went wrong",
};

const STAGE_INDEX: Record<ScriptStage, number> = {
  part1: 0,
  part2_intro: 1,
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
  // Live caption — the examiner's current line as Whisper transcribes it.
  // Updated from `response.audio_transcript.delta` events on the data channel.
  const [captionText, setCaptionText] = useState("");

  const router = useRouter();

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const scriptRef = useRef<ExaminerScript | null>(null);
  const prepTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Part 2 hand-off → prep auto-advance. Set when the runner enters
  // part2_intro; the next `response.done` (= examiner finished the
  // hand-off) flips to part2_prep + starts the 60s timer. The safety
  // timeout fires the same transition if response.done never arrives.
  const pendingPart2PrepAdvanceRef = useRef<boolean>(false);
  const introSafetyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  // ── Recording state (Phase 3) ──────────────────────────────────────────
  // `mediaRecorderRef` is the MediaRecorder running on the mic-only stream.
  // We capture only the candidate's mic — the examiner's audio is on the
  // remote WebRTC track, not the local stream — so the transcript is the
  // candidate's words alone (which is what grading needs).
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordingMimeTypeRef = useRef<string | null>(null);
  const recordingStartedAtRef = useRef<number | null>(null);
  // Filled in at each stage transition; missing entries mean the learner
  // ended before reaching that stage (handled in finalize).
  const boundariesMsRef = useRef<Partial<StageBoundariesMs>>({});
  // The recorded blob is kept in memory so the upload can be retried on
  // network failure without re-running the conversation.
  const recordedBlobRef = useRef<Blob | null>(null);
  const recordedDurationMsRef = useRef<number>(0);
  const [submitErrorMessage, setSubmitErrorMessage] = useState<string | null>(
    null,
  );

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
    if (introSafetyTimeoutRef.current) {
      clearTimeout(introSafetyTimeoutRef.current);
      introSafetyTimeoutRef.current = null;
    }
    pendingPart2PrepAdvanceRef.current = false;
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
    // Mic stream is stopped only AFTER the recorder finishes; otherwise we
    // truncate the last few hundred ms of the candidate's audio.
    const mr = mediaRecorderRef.current;
    if (mr && mr.state !== "inactive") {
      try {
        mr.stop();
      } catch {
        /* noop */
      }
    }
    if (localStreamRef.current) {
      for (const t of localStreamRef.current.getTracks()) t.stop();
      localStreamRef.current = null;
    }
    if (audioRef.current) audioRef.current.srcObject = null;
    setExaminerSpeaking(false);
  }

  // ── MediaRecorder helpers ──────────────────────────────────────────────

  function pickRecorderMime(): string | null {
    if (typeof MediaRecorder === "undefined") return null;
    const candidates = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/mp4",
    ];
    for (const m of candidates) {
      try {
        if (MediaRecorder.isTypeSupported(m)) return m;
      } catch {
        /* noop */
      }
    }
    return null;
  }

  function startRecorder(stream: MediaStream): boolean {
    const mime = pickRecorderMime();
    if (!mime) return false;
    try {
      const mr = new MediaRecorder(stream, { mimeType: mime });
      recordedChunksRef.current = [];
      recordingMimeTypeRef.current = mime;
      mr.addEventListener("dataavailable", (e) => {
        if (e.data && e.data.size > 0) {
          recordedChunksRef.current.push(e.data);
        }
      });
      mr.start();
      mediaRecorderRef.current = mr;
      recordingStartedAtRef.current = Date.now();
      boundariesMsRef.current = {};
      return true;
    } catch (err) {
      console.error("Failed to start MediaRecorder", err);
      return false;
    }
  }

  function stopRecorderAndCollect(): Promise<Blob | null> {
    const mr = mediaRecorderRef.current;
    if (!mr) return Promise.resolve(null);
    if (mr.state === "inactive") {
      const mime = recordingMimeTypeRef.current ?? "audio/webm";
      const blob = new Blob(recordedChunksRef.current, { type: mime });
      return Promise.resolve(blob.size > 0 ? blob : null);
    }
    return new Promise((resolve) => {
      const handleStop = () => {
        mr.removeEventListener("stop", handleStop);
        const mime = recordingMimeTypeRef.current ?? "audio/webm";
        const blob = new Blob(recordedChunksRef.current, { type: mime });
        resolve(blob.size > 0 ? blob : null);
      };
      mr.addEventListener("stop", handleStop);
      try {
        mr.stop();
      } catch (err) {
        console.error("MediaRecorder.stop threw", err);
        mr.removeEventListener("stop", handleStop);
        resolve(null);
      }
    });
  }

  function elapsedSinceRecordingStart(): number {
    const start = recordingStartedAtRef.current;
    if (start === null) return 0;
    return Math.max(0, Date.now() - start);
  }

  function markBoundary(key: keyof StageBoundariesMs): void {
    if (recordingStartedAtRef.current === null) return;
    boundariesMsRef.current[key] = elapsedSinceRecordingStart();
  }

  // ── Data-channel send helpers ──────────────────────────────────────────

  function sendStageUpdate(stageName: ScriptStage): void {
    const dc = dcRef.current;
    const script = scriptRef.current;
    if (!dc || dc.readyState !== "open" || !script) return;
    const cfg = script[stageName];
    // GA session.update shape: `session` carries the `type: "realtime"`
    // discriminator and turn-detection lives under `audio.input`. The Beta
    // top-level `turn_detection` is no longer accepted.
    dc.send(
      JSON.stringify({
        type: "session.update",
        session: {
          type: "realtime",
          instructions: cfg.instructions,
          audio: {
            input: {
              turn_detection:
                cfg.turn_detection === "server_vad" ? VAD_CONFIG : null,
            },
          },
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

    // Start recording the candidate's mic. We do this BEFORE the WebRTC
    // connect so the first words (the examiner's greeting + our reply)
    // are captured.
    const recorderStarted = startRecorder(micStream);
    if (!recorderStarted) {
      // No usable MediaRecorder — the conversation can still run, but we
      // can't submit a graded attempt. Surface the limitation up front
      // rather than letting the learner finish and discover it at End.
      console.warn(
        "MediaRecorder unavailable — Speaking session will run without recording.",
      );
    }

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

      // GA WebRTC SDP-exchange endpoint. The Beta `/v1/realtime?model=...`
      // path is retired with the same `beta_api_shape_disabled` error as
      // the old `/v1/realtime/sessions` token-mint path.
      const sdpResponse = await fetch(
        `https://api.openai.com/v1/realtime/calls?model=${encodeURIComponent(outcome.model)}`,
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
    // The IELTS structure is driven by the runner via session.update — the
    // events we care about here are the ones that update on-screen state:
    // examiner-speaking indicator, live captions, and the part2_intro →
    // part2_prep auto-advance.
    type RealtimeEvent = {
      type?: string;
      delta?: unknown;
      transcript?: unknown;
    };
    let parsed: RealtimeEvent;
    try {
      parsed = JSON.parse(e.data) as RealtimeEvent;
    } catch {
      return;
    }
    const t = parsed.type;

    if (t === "response.created") {
      setExaminerSpeaking(true);
      setCaptionText("");
    } else if (t === "response.done" || t === "response.cancelled") {
      setExaminerSpeaking(false);
    }

    // Live captions — the GA Realtime API emits audio-transcript deltas
    // under one of these two event names depending on the model snapshot;
    // accept both so we don't silently lose captions if the name flips.
    if (
      t === "response.audio_transcript.delta" ||
      t === "response.output_audio_transcript.delta"
    ) {
      if (typeof parsed.delta === "string") {
        const delta = parsed.delta;
        setCaptionText((prev) => prev + delta);
      }
    } else if (
      t === "response.audio_transcript.done" ||
      t === "response.output_audio_transcript.done"
    ) {
      if (typeof parsed.transcript === "string") {
        setCaptionText(parsed.transcript);
      }
    }

    // Auto-advance from the hand-off into the silent prep minute as soon
    // as the examiner finishes their canonical Part 2 intro. response.cancelled
    // never fires here (we don't send response.cancel after entering intro),
    // so a normal response.done is the right edge to trigger on.
    if (t === "response.done" && pendingPart2PrepAdvanceRef.current) {
      pendingPart2PrepAdvanceRef.current = false;
      advanceToPart2Prep();
    }
  }

  function moveToPart2Intro() {
    markBoundary("part1End");
    // Cut any in-flight Part 1 response so the examiner doesn't keep
    // answering a sub-topic through the hand-off. response.cancel emits
    // response.cancelled (not response.done) so it can't trigger the
    // pending auto-advance below.
    const dc = dcRef.current;
    if (dc && dc.readyState === "open") {
      try {
        dc.send(JSON.stringify({ type: "response.cancel" }));
      } catch {
        /* noop */
      }
    }
    setStage("part2_intro");
    sendStageUpdate("part2_intro");
    // Arm the auto-advance: the NEXT response.done = examiner finished
    // the hand-off → switch to the silent 60s prep.
    pendingPart2PrepAdvanceRef.current = true;
    if (introSafetyTimeoutRef.current) {
      clearTimeout(introSafetyTimeoutRef.current);
    }
    introSafetyTimeoutRef.current = setTimeout(() => {
      if (pendingPart2PrepAdvanceRef.current) {
        pendingPart2PrepAdvanceRef.current = false;
        advanceToPart2Prep();
      }
    }, PART2_INTRO_SAFETY_MS);
  }

  function advanceToPart2Prep() {
    if (introSafetyTimeoutRef.current) {
      clearTimeout(introSafetyTimeoutRef.current);
      introSafetyTimeoutRef.current = null;
    }
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
          markBoundary("part2PrepEnd");
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
    markBoundary("part2PrepEnd");
    setStage("part2_long_turn");
    sendStageUpdate("part2_long_turn");
  }

  function finishLongTurn() {
    markBoundary("part2LongTurnEnd");
    setStage("part2_followup");
    sendStageUpdate("part2_followup");
  }

  function moveToPart3() {
    markBoundary("part2FollowupEnd");
    setStage("part3");
    sendStageUpdate("part3");
  }

  // ── End-of-test: recording → upload → finalize → results ──────────────

  async function endTest() {
    // 1. Stop the recorder and wait for the blob. Tear down the WebRTC
    //    side; we keep the mic stream alive until the recorder confirms it
    //    has flushed (stopRecorderAndCollect handles that).
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
    if (prepTimerRef.current) {
      clearInterval(prepTimerRef.current);
      prepTimerRef.current = null;
    }

    const recordingActive = mediaRecorderRef.current !== null;
    const elapsed = elapsedSinceRecordingStart();
    recordedDurationMsRef.current = elapsed;

    const blob = await stopRecorderAndCollect();

    // Stop the mic AFTER the recorder is done.
    if (localStreamRef.current) {
      for (const t of localStreamRef.current.getTracks()) t.stop();
      localStreamRef.current = null;
    }
    if (audioRef.current) audioRef.current.srcObject = null;
    setExaminerSpeaking(false);

    if (!recordingActive || !blob) {
      // No usable recording — fall back to the Abandoned path.
      const res = await endSpeakingAttempt(attemptId);
      if (!res.ok) {
        console.warn("endSpeakingAttempt failed", res.error);
      }
      setStage("ended");
      return;
    }

    recordedBlobRef.current = blob;
    await runUploadAndFinalize();
  }

  async function runUploadAndFinalize() {
    const blob = recordedBlobRef.current;
    const mime = recordingMimeTypeRef.current;
    if (!blob || !mime) {
      setStage("submit_error");
      setSubmitErrorMessage(
        "The recording wasn't captured. End the test to mark the attempt as abandoned.",
      );
      return;
    }
    setSubmitErrorMessage(null);
    setStage("uploading");

    const upReq = await requestRecordingUpload({
      attemptId,
      mimeType: mime,
    });
    if (!upReq.ok) {
      setStage("submit_error");
      setSubmitErrorMessage(submitErrorFor(upReq.error));
      return;
    }

    const uploaded = await putBlobWithRetry(upReq.uploadUrl, blob, mime);
    if (!uploaded) {
      setStage("submit_error");
      setSubmitErrorMessage(
        "We couldn't upload your recording. Check your connection and try again.",
      );
      return;
    }

    setStage("finalizing");

    // Fill any unset boundaries with the recording's end timestamp so the
    // server-side validation (monotonic + within duration) holds even when
    // the learner ended mid-test.
    const elapsed = recordedDurationMsRef.current;
    const b = boundariesMsRef.current;
    const boundaries: StageBoundariesMs = {
      part1End: b.part1End ?? elapsed,
      part2PrepEnd: b.part2PrepEnd ?? elapsed,
      part2LongTurnEnd: b.part2LongTurnEnd ?? elapsed,
      part2FollowupEnd: b.part2FollowupEnd ?? elapsed,
      part3End: elapsed,
    };

    const finalize = await finalizeSpeakingAttempt({
      attemptId,
      mimeType: mime,
      durationMs: elapsed,
      boundariesMs: boundaries,
    });
    if (!finalize.ok) {
      setStage("submit_error");
      setSubmitErrorMessage(submitErrorFor(finalize.error));
      return;
    }

    // Recording uploaded + transcribed; navigate to the results page.
    router.push(`/results/${attemptId}`);
  }

  async function abandonAndEnd() {
    teardownWebRTC();
    const res = await endSpeakingAttempt(attemptId);
    if (!res.ok) {
      console.warn("endSpeakingAttempt failed", res.error);
    }
    setStage("ended");
  }

  // ── Render ─────────────────────────────────────────────────────────────

  const stageIndex =
    stage === "part1" ||
    stage === "part2_intro" ||
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
            caption={captionText}
            onNext={moveToPart2Intro}
            onEnd={endTest}
          />
        ) : stage === "part2_intro" ? (
          <Part2IntroView
            content={content}
            examinerSpeaking={examinerSpeaking}
            caption={captionText}
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
            caption={captionText}
            onNext={moveToPart3}
            onEnd={endTest}
          />
        ) : stage === "part3" ? (
          <Part3View
            content={content}
            examinerSpeaking={examinerSpeaking}
            caption={captionText}
            onEnd={endTest}
          />
        ) : stage === "uploading" ? (
          <ProcessingView
            title="Uploading your recording…"
            body="Hang tight — this usually takes a few seconds."
          />
        ) : stage === "finalizing" ? (
          <ProcessingView
            title="Transcribing your conversation…"
            body="The examiner's grading the conversation. This can take 20–40 seconds."
          />
        ) : stage === "submit_error" ? (
          <SubmitErrorView
            message={submitErrorMessage}
            onRetry={() => {
              void runUploadAndFinalize();
            }}
            onAbandon={() => {
              void abandonAndEnd();
            }}
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
            // suppressHydrationWarning is a belt-and-braces backstop —
            // useElapsed already returns null on first render so the
            // strings match, but Safari sometimes ticks the interval
            // slightly out of phase with React's hydration.
            suppressHydrationWarning
          >
            {elapsed !== null ? formatElapsed(elapsed) : "0:00"}
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

// Live caption for the examiner's current turn. Text streams in from
// `response.audio_transcript.delta` events on the data channel.
// aria-live="polite" lets screen readers announce updates without
// interrupting other content.
function CaptionBar({ text }: { text: string }) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  return (
    <div
      className="rounded-md bg-brand-black/90 text-white px-4 py-3"
      aria-live="polite"
      aria-label="Examiner caption"
    >
      <p className="font-body text-sm leading-relaxed">{trimmed}</p>
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

function ProcessingView({ title, body }: { title: string; body: string }) {
  return (
    <Panel>
      <div className="flex items-center gap-3">
        <span
          className="inline-block w-3 h-3 rounded-full bg-brand-red animate-pulse"
          aria-hidden="true"
        />
        <h2 className="font-heading font-bold text-xl text-brand-black">
          {title}
        </h2>
      </div>
      <p className="font-body text-base text-brand-grey-700">{body}</p>
    </Panel>
  );
}

function SubmitErrorView({
  message,
  onRetry,
  onAbandon,
}: {
  message: string | null;
  onRetry: () => void;
  onAbandon: () => void;
}) {
  return (
    <Panel>
      <h2 className="font-heading font-bold text-xl text-brand-black">
        Submission hit a snag
      </h2>
      <p className="font-body text-base text-brand-grey-700">
        {message ??
          "We couldn't submit your recording. Your conversation audio is still in memory — try again."}
      </p>
      <div className="flex flex-wrap gap-3">
        <PrimaryButton onClick={onRetry}>Try submitting again</PrimaryButton>
        <SecondaryButton onClick={onAbandon}>
          Give up — mark as abandoned
        </SecondaryButton>
      </div>
    </Panel>
  );
}

function Part1View({
  content,
  examinerSpeaking,
  caption,
  onNext,
  onEnd,
}: {
  content: SpeakingContent;
  examinerSpeaking: boolean;
  caption: string;
  onNext: () => void;
  onEnd: () => void;
}) {
  return (
    <div className="space-y-6">
      <Panel>
        <ExaminerIndicator speaking={examinerSpeaking} />
        <CaptionBar text={caption} />
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

function Part2IntroView({
  content,
  examinerSpeaking,
  caption,
  onEnd,
}: {
  content: SpeakingContent;
  examinerSpeaking: boolean;
  caption: string;
  onEnd: () => void;
}) {
  return (
    <div className="space-y-6">
      <Panel>
        <ExaminerIndicator speaking={examinerSpeaking} />
        <CaptionBar text={caption} />
        <p className="font-body text-base text-brand-grey-700">
          The examiner is handing you the cue card. Your one minute of prep
          will start as soon as they finish reading the instructions.
        </p>
        <pre className="font-body text-base text-brand-grey-900 leading-relaxed whitespace-pre-wrap bg-brand-grey-50 rounded-md ring-1 ring-brand-grey-200 p-4">
          {renderCueCard(content.part2)}
        </pre>
      </Panel>
      <div className="flex flex-wrap gap-3 items-center">
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
  caption,
  onNext,
  onEnd,
}: {
  examinerSpeaking: boolean;
  caption: string;
  onNext: () => void;
  onEnd: () => void;
}) {
  return (
    <div className="space-y-6">
      <Panel>
        <ExaminerIndicator speaking={examinerSpeaking} />
        <CaptionBar text={caption} />
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
  caption,
  onEnd,
}: {
  content: SpeakingContent;
  examinerSpeaking: boolean;
  caption: string;
  onEnd: () => void;
}) {
  return (
    <div className="space-y-6">
      <Panel>
        <ExaminerIndicator speaking={examinerSpeaking} />
        <CaptionBar text={caption} />
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
        Attempt ended.
      </h2>
      <p className="font-body text-base text-brand-grey-700">
        This attempt was ended without a recording, so there&apos;s nothing
        to grade — it&apos;s logged as abandoned. Start a fresh test from the
        picker whenever you&apos;re ready.
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

function submitErrorFor(error: string): string {
  switch (error) {
    case "not_found":
      return "This attempt is no longer available.";
    case "wrong_status":
      return "This attempt has already been submitted.";
    case "bad_mime":
      return "Your browser produced an unsupported recording format.";
    case "bad_boundaries":
      return "The stage timing data is invalid. Refresh and start again.";
    case "missing_questions":
      return "The Speaking test is missing one of its parts — please pick another.";
    case "storage_unavailable":
      return "Recording storage is unavailable. Try again in a moment.";
    case "quota":
      return "You've reached your daily AI quota. It resets at midnight UTC.";
    case "transcribe":
      return "The transcription service is having a moment. Try again.";
    default:
      return "Something went wrong submitting your recording.";
  }
}

const UPLOAD_RETRIES = 1;

async function putBlobWithRetry(
  url: string,
  blob: Blob,
  contentType: string,
): Promise<boolean> {
  for (let attempt = 0; attempt <= UPLOAD_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        method: "PUT",
        body: blob,
        headers: { "Content-Type": contentType },
      });
      if (res.ok) return true;
      // 4xx is a hard failure — don't retry (the URL is wrong, expired, or
      // the bucket rejected the upload). 5xx is worth one retry.
      if (res.status >= 400 && res.status < 500) return false;
    } catch {
      // Network error — retry.
    }
    // Small backoff before retry.
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

// SSR-safe: the elapsed time is `null` on the first render so the server
// and the client's hydration pass agree (the server has no clock running on
// the page). The effect populates the real elapsed value after mount and
// then ticks every second.
function useElapsed(startedAtIso: string): number | null {
  const [elapsed, setElapsed] = useState<number | null>(null);
  useEffect(() => {
    const tick = () =>
      setElapsed(Math.max(0, Date.now() - new Date(startedAtIso).getTime()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startedAtIso]);
  return elapsed;
}

function formatElapsed(ms: number): string {
  const sec = Math.floor(ms / 1000);
  const m = Math.floor(sec / 60)
    .toString()
    .padStart(2, "0");
  const s = (sec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}
