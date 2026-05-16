import { describe, expect, it, vi } from "vitest";
import type { OrgContext } from "@elc/db";
import type { TtsRequest, TtsResponse } from "../gateway";
import { sampleListeningContent } from "./fixtures";
import {
  attachSynthesizedClips,
  computeAudioClipKey,
  createTtsCache,
  planSynthesisJobs,
} from "./tts-cache";

const CTX: OrgContext = {
  org_id: "org_1",
  user_id: "user_1",
  role: "SuperAdmin",
};

function fakeTts(
  audio: Uint8Array = new Uint8Array([0x49, 0x44, 0x33]),
  mimeType = "audio/mpeg",
): {
  fn: (req: TtsRequest) => Promise<TtsResponse>;
  calls: number;
} {
  let calls = 0;
  return {
    fn: async () => {
      calls++;
      return {
        audio,
        mimeType,
        model: "eleven_multilingual_v2",
        quota_weight: 1,
      };
    },
    get calls() {
      return calls;
    },
  };
}

function fakeStorage(initial: Set<string> = new Set()) {
  const present = new Set(initial);
  const puts: Array<{ key: string; bytes: Uint8Array; contentType: string }> =
    [];
  return {
    objectExists: async ({ key }: { key: string }) => present.has(key),
    putObject: async (args: {
      key: string;
      bytes: Uint8Array;
      contentType: string;
    }) => {
      present.add(args.key);
      puts.push(args);
    },
    puts,
    present,
  };
}

describe("computeAudioClipKey — determinism + collision-resistance", () => {
  it("produces the same key for the same inputs", () => {
    const a = computeAudioClipKey({
      text: "Welcome to Riverside Library.",
      voice_id: "voice_1",
      format: "mp3",
    });
    const b = computeAudioClipKey({
      text: "Welcome to Riverside Library.",
      voice_id: "voice_1",
      format: "mp3",
    });
    expect(a.sha256).toBe(b.sha256);
    expect(a.storage_key).toBe(b.storage_key);
  });

  it("differs when the voice id changes", () => {
    const a = computeAudioClipKey({
      text: "Hello",
      voice_id: "voice_a",
      format: "mp3",
    });
    const b = computeAudioClipKey({
      text: "Hello",
      voice_id: "voice_b",
      format: "mp3",
    });
    expect(a.sha256).not.toBe(b.sha256);
  });

  it("differs when the model id changes", () => {
    const a = computeAudioClipKey({
      text: "Hello",
      voice_id: "v",
      format: "mp3",
    });
    const b = computeAudioClipKey({
      text: "Hello",
      voice_id: "v",
      model_id: "eleven_v3",
      format: "mp3",
    });
    expect(a.sha256).not.toBe(b.sha256);
  });

  it("differs when the format changes", () => {
    const a = computeAudioClipKey({
      text: "Hello",
      voice_id: "v",
      format: "mp3",
    });
    const b = computeAudioClipKey({
      text: "Hello",
      voice_id: "v",
      format: "wav",
    });
    expect(a.sha256).not.toBe(b.sha256);
    expect(a.storage_key.endsWith(".mp3")).toBe(true);
    expect(b.storage_key.endsWith(".wav")).toBe(true);
  });

  it("differs when the language_code changes", () => {
    const a = computeAudioClipKey({
      text: "Hello",
      voice_id: "v",
      format: "mp3",
      language_code: "en",
    });
    const b = computeAudioClipKey({
      text: "Hello",
      voice_id: "v",
      format: "mp3",
      language_code: "fr",
    });
    expect(a.sha256).not.toBe(b.sha256);
  });

  it("produces a valid 64-hex sha256 and an audio/ key", () => {
    const k = computeAudioClipKey({
      text: "Hello",
      voice_id: "v",
      format: "mp3",
    });
    expect(k.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(k.storage_key).toBe(`audio/${k.sha256}.mp3`);
  });
});

describe("planSynthesisJobs — fixture walk", () => {
  it("emits one job per speech and narration segment", () => {
    const jobs = planSynthesisJobs(sampleListeningContent, "test_fixture");
    let speechAndNarration = 0;
    for (const p of sampleListeningContent.parts) {
      for (const s of p.transcript) {
        if (s.kind === "speech" || s.kind === "narration") {
          speechAndNarration += 1;
        }
      }
    }
    expect(jobs.length).toBe(speechAndNarration);
  });

  it("skips reading-pause and questions-preview segments", () => {
    const jobs = planSynthesisJobs(sampleListeningContent, "test_fixture");
    const addresses = new Set(
      jobs.map((j) => `${j.part_index}:${j.segment_index}`),
    );
    for (let pi = 0; pi < sampleListeningContent.parts.length; pi++) {
      const part = sampleListeningContent.parts[pi]!;
      for (let si = 0; si < part.transcript.length; si++) {
        const seg = part.transcript[si]!;
        const present = addresses.has(`${pi}:${si}`);
        if (seg.kind === "speech" || seg.kind === "narration") {
          expect(present, `${pi}:${si} ${seg.kind}`).toBe(true);
        } else {
          expect(present, `${pi}:${si} ${seg.kind}`).toBe(false);
        }
      }
    }
  });

  it("is deterministic across runs for the same testId", () => {
    const a = planSynthesisJobs(sampleListeningContent, "test_x");
    const b = planSynthesisJobs(sampleListeningContent, "test_x");
    expect(a.map((j) => j.voice_id)).toEqual(b.map((j) => j.voice_id));
  });

  it("flags fallback resolution when an accent has no direct voices", () => {
    // Fabricate a content with a Canadian speaker so we trigger the
    // catalogue fallback (canadian → american). We do not call the parser
    // — this is a shape stress test of planSynthesisJobs.
    const content = structuredClone(sampleListeningContent);
    content.parts[2]!.speakers[1]!.accent = "canadian";
    const jobs = planSynthesisJobs(content, "test_can");
    const canadianSpeakerId = content.parts[2]!.speakers[1]!.id;
    const job = jobs.find(
      (j) => j.part_index === 2 && j.speaker_id === canadianSpeakerId,
    );
    expect(job, "expected a job for the canadian speaker").toBeTruthy();
    expect(job?.requested_accent).toBe("canadian");
    expect(job?.resolved_accent).toBe("american");
  });

  it("skips segments that already have an audio_clip attached", () => {
    const content = structuredClone(sampleListeningContent);
    // Attach a pretend clip to part 0, segment 0 (narration "Now turn to Part 1.")
    content.parts[0]!.transcript[0] = {
      kind: "narration",
      text: "Now turn to Part 1.",
      audio_clip: {
        storage_key: "audio/" + "a".repeat(64) + ".mp3",
        duration_sec: 2,
        sha256: "a".repeat(64),
        format: "mp3",
      },
    };
    const jobs = planSynthesisJobs(content, "test_x");
    const hit = jobs.find(
      (j) => j.part_index === 0 && j.segment_index === 0,
    );
    expect(hit).toBeUndefined();
  });
});

describe("synthesizeAndCache — hit + miss", () => {
  it("hits the cache: no tts call, no put", async () => {
    const tts = fakeTts();
    // Pre-populate the storage with the exact key the cache will compute.
    const key = computeAudioClipKey({
      text: "Welcome to Riverside Library.",
      voice_id: "voice_1",
      format: "mp3",
    });
    const storage = fakeStorage(new Set([key.storage_key]));
    const cache = createTtsCache({
      tts: tts.fn,
      objectExists: storage.objectExists,
      putObject: storage.putObject,
    });
    const result = await cache.synthesizeAndCache({
      ctx: CTX,
      text: "Welcome to Riverside Library.",
      voice_id: "voice_1",
    });
    expect(result.cache).toBe("hit");
    expect(result.storage_key).toBe(key.storage_key);
    expect(result.sha256).toBe(key.sha256);
    expect(result.format).toBe("mp3");
    expect(result.duration_sec).toBeGreaterThan(0);
    expect(tts.calls).toBe(0);
    expect(storage.puts).toHaveLength(0);
  });

  it("misses the cache: synth + put + return descriptor", async () => {
    const tts = fakeTts();
    const storage = fakeStorage();
    const cache = createTtsCache({
      tts: tts.fn,
      objectExists: storage.objectExists,
      putObject: storage.putObject,
    });
    const result = await cache.synthesizeAndCache({
      ctx: CTX,
      text: "Hello world.",
      voice_id: "voice_2",
    });
    expect(result.cache).toBe("miss");
    expect(tts.calls).toBe(1);
    expect(storage.puts).toHaveLength(1);
    expect(storage.puts[0]!.contentType).toBe("audio/mpeg");
    expect(storage.puts[0]!.key).toBe(result.storage_key);
  });

  it("re-call after a miss hits the cache (storage state survives)", async () => {
    const tts = fakeTts();
    const storage = fakeStorage();
    const cache = createTtsCache({
      tts: tts.fn,
      objectExists: storage.objectExists,
      putObject: storage.putObject,
    });
    const first = await cache.synthesizeAndCache({
      ctx: CTX,
      text: "Hello again.",
      voice_id: "voice_3",
    });
    const second = await cache.synthesizeAndCache({
      ctx: CTX,
      text: "Hello again.",
      voice_id: "voice_3",
    });
    expect(first.cache).toBe("miss");
    expect(second.cache).toBe("hit");
    expect(tts.calls).toBe(1);
    expect(storage.puts).toHaveLength(1);
    expect(second.storage_key).toBe(first.storage_key);
  });

  it("throws if the TTS response mime type doesn't match the assumed format", async () => {
    const tts = fakeTts(new Uint8Array([1]), "audio/wav");
    const storage = fakeStorage();
    const cache = createTtsCache({
      tts: tts.fn,
      objectExists: storage.objectExists,
      putObject: storage.putObject,
    });
    await expect(
      cache.synthesizeAndCache({
        ctx: CTX,
        text: "x",
        voice_id: "v",
        format: "mp3",
      }),
    ).rejects.toThrow(/Provider configuration drift/);
    // We do NOT want to upload the wrong-format bytes under an .mp3 key.
    expect(storage.puts).toHaveLength(0);
  });

  it("propagates TTS errors without writing to storage", async () => {
    const tts = vi.fn(async () => {
      throw new Error("upstream 500");
    });
    const storage = fakeStorage();
    const cache = createTtsCache({
      tts,
      objectExists: storage.objectExists,
      putObject: storage.putObject,
    });
    await expect(
      cache.synthesizeAndCache({
        ctx: CTX,
        text: "x",
        voice_id: "v",
      }),
    ).rejects.toThrow("upstream 500");
    expect(storage.puts).toHaveLength(0);
  });
});

describe("attachSynthesizedClips", () => {
  it("returns a new content with clips attached, without mutating the input", () => {
    const clip = {
      storage_key: "audio/" + "c".repeat(64) + ".mp3",
      duration_sec: 3,
      sha256: "c".repeat(64),
      format: "mp3" as const,
    };
    const next = attachSynthesizedClips(sampleListeningContent, [
      { part_index: 0, segment_index: 0, clip },
    ]);
    expect(next).not.toBe(sampleListeningContent);
    expect(next.parts[0]!.transcript[0]!.kind).toBe("narration");
    const seg = next.parts[0]!.transcript[0];
    if (seg && seg.kind === "narration") {
      expect(seg.audio_clip).toEqual(clip);
    } else {
      throw new Error("expected narration segment at [0][0]");
    }
    // Original untouched.
    const origSeg = sampleListeningContent.parts[0]!.transcript[0];
    if (origSeg && origSeg.kind === "narration") {
      expect(origSeg.audio_clip).toBeUndefined();
    }
  });

  it("leaves reading-pause / questions-preview unchanged even if addressed", () => {
    const clip = {
      storage_key: "audio/" + "d".repeat(64) + ".mp3",
      duration_sec: 1,
      sha256: "d".repeat(64),
      format: "mp3" as const,
    };
    // Find a reading-pause segment and try (incorrectly) to attach a clip
    // to it — the helper should be defensive and just no-op.
    const pi = 0;
    const si = sampleListeningContent.parts[pi]!.transcript.findIndex(
      (s) => s.kind === "reading-pause",
    );
    expect(si).toBeGreaterThan(-1);
    const next = attachSynthesizedClips(sampleListeningContent, [
      { part_index: pi, segment_index: si, clip },
    ]);
    const seg = next.parts[pi]!.transcript[si]!;
    expect(seg.kind).toBe("reading-pause");
    expect("audio_clip" in seg).toBe(false);
  });
});
