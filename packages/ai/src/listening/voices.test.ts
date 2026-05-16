import { describe, expect, it } from "vitest";
import type { ListeningSpeaker } from "./content";
import {
  DEFAULT_VOICE_CATALOGUE,
  pickVoiceForSpeaker,
  roleBucket,
  type VoiceCatalogue,
} from "./voices";

function speaker(
  partial: Partial<ListeningSpeaker> = {},
): ListeningSpeaker {
  return {
    id: "spk_1",
    name: "Test Speaker",
    role: "speaker",
    accent: "british",
    ...partial,
  };
}

describe("roleBucket", () => {
  it("maps narrator + examiner to narration", () => {
    expect(roleBucket("narrator")).toBe("narration");
    expect(roleBucket("examiner")).toBe("narration");
  });

  it("maps speaker to conversation", () => {
    expect(roleBucket("speaker")).toBe("conversation");
  });
});

describe("DEFAULT_VOICE_CATALOGUE — coverage sanity", () => {
  it("has direct narration + conversation entries for the well-covered accents", () => {
    for (const accent of ["british", "american", "australian"] as const) {
      expect(
        DEFAULT_VOICE_CATALOGUE[accent].narration.length,
      ).toBeGreaterThan(0);
      expect(
        DEFAULT_VOICE_CATALOGUE[accent].conversation.length,
      ).toBeGreaterThan(0);
    }
  });

  it("documents missing canadian + nz coverage via empty arrays (not undefined)", () => {
    expect(DEFAULT_VOICE_CATALOGUE.canadian.narration).toEqual([]);
    expect(DEFAULT_VOICE_CATALOGUE.canadian.conversation).toEqual([]);
    expect(DEFAULT_VOICE_CATALOGUE["new-zealand"].narration).toEqual([]);
    expect(DEFAULT_VOICE_CATALOGUE["new-zealand"].conversation).toEqual([]);
  });
});

describe("pickVoiceForSpeaker — determinism", () => {
  it("returns the same voice for the same (testId, speaker.id)", () => {
    const s = speaker({ accent: "american", role: "speaker" });
    const a = pickVoiceForSpeaker(s, "test_xyz");
    const b = pickVoiceForSpeaker(s, "test_xyz");
    expect(a.voice_id).toBe(b.voice_id);
  });

  it("varies across testIds (the picker hashes both inputs)", () => {
    const s = speaker({ accent: "american", role: "speaker" });
    const picks = new Set(
      Array.from({ length: 40 }, (_, i) =>
        pickVoiceForSpeaker(s, `test_${i}`).voice_id,
      ),
    );
    // With 3 candidate american conversational voices, 40 different testIds
    // should hit at least two of them.
    expect(picks.size).toBeGreaterThan(1);
  });

  it("respects an explicit voice_id override on the speaker", () => {
    const s = speaker({
      accent: "british",
      voice_id: "voice_override_xxx",
    });
    expect(pickVoiceForSpeaker(s, "test_xyz").voice_id).toBe(
      "voice_override_xxx",
    );
  });
});

describe("pickVoiceForSpeaker — fallback chain", () => {
  it("falls back to American for Canadian (no direct catalogue entries)", () => {
    const s = speaker({ accent: "canadian", role: "speaker" });
    const picked = pickVoiceForSpeaker(s, "test_can");
    expect(picked.requested).toBe("canadian");
    expect(picked.resolved).toBe("american");
    expect(
      DEFAULT_VOICE_CATALOGUE.american.conversation.includes(picked.voice_id),
    ).toBe(true);
  });

  it("falls back to Australian for New Zealand", () => {
    const s = speaker({ accent: "new-zealand", role: "narrator" });
    const picked = pickVoiceForSpeaker(s, "test_nz");
    expect(picked.requested).toBe("new-zealand");
    expect(picked.resolved).toBe("australian");
  });

  it("falls back across role buckets if necessary", () => {
    // A catalogue that has ONLY narration entries for american; a
    // conversational request must fall through to the other bucket on the
    // same accent, then to fallback accents.
    const catalogue: VoiceCatalogue = {
      british: { narration: [], conversation: [] },
      american: {
        narration: ["only-american-narration"],
        conversation: [],
      },
      australian: { narration: [], conversation: [] },
      canadian: { narration: [], conversation: [] },
      "new-zealand": { narration: [], conversation: [] },
    };
    const s = speaker({ accent: "american", role: "speaker" });
    const picked = pickVoiceForSpeaker(s, "test_x", { catalogue });
    expect(picked.voice_id).toBe("only-american-narration");
  });

  it("throws if the catalogue is completely empty", () => {
    const catalogue: VoiceCatalogue = {
      british: { narration: [], conversation: [] },
      american: { narration: [], conversation: [] },
      australian: { narration: [], conversation: [] },
      canadian: { narration: [], conversation: [] },
      "new-zealand": { narration: [], conversation: [] },
    };
    expect(() =>
      pickVoiceForSpeaker(speaker(), "test_x", { catalogue }),
    ).toThrow(/empty/);
  });
});

describe("pickVoiceForSpeaker — distributes across speakers", () => {
  it("two different speaker ids on the same Test usually pick different voices", () => {
    const a = speaker({ id: "spk_a", accent: "american", role: "speaker" });
    const b = speaker({ id: "spk_b", accent: "american", role: "speaker" });
    // Across 20 different testIds, the (spk_a, spk_b) pair should land on
    // different voices at least some of the time. With 3 candidate voices
    // and 20 trials the probability of always matching is ~(1/3)^19 ≈ 0,
    // so this is a stable assertion.
    let diffs = 0;
    for (let i = 0; i < 20; i++) {
      const va = pickVoiceForSpeaker(a, `test_${i}`).voice_id;
      const vb = pickVoiceForSpeaker(b, `test_${i}`).voice_id;
      if (va !== vb) diffs++;
    }
    expect(diffs).toBeGreaterThan(0);
  });
});
