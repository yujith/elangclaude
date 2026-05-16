// Voice catalogue + deterministic picker for Listening TTS.
//
// Real IELTS Listening uses multiple accents (British, American, Australian,
// plus the occasional Canadian / New Zealand voice). Each ListeningSpeaker
// in the script carries an `accent` field; this module turns that — plus a
// role hint — into an ElevenLabs voice_id.
//
// Two design constraints:
//
//   1. **Determinism.** The same Listening Test must synthesise with the
//      same voices every time. Otherwise a SuperAdmin's approval-time
//      preview diverges from what a learner hears on retake, and the cache
//      keys (which are content-hashed) churn for no reason. The picker
//      hashes (testId, speaker.id) into the candidate list, so the choice
//      is stable across runs.
//
//   2. **Curatability.** The voice_id values below are best-effort stock
//      ElevenLabs voices known at time of writing. They are loaded into a
//      mutable catalogue object so a Phase 7 content pass can override per
//      accent without touching the picker logic. Treat the IDs here as
//      defaults — confirm against api.elevenlabs.io/v1/voices before the
//      SuperAdmin moderation flow opens past a dev org.
//
// The picker never returns null — if no voice exists for the requested
// (accent, role), it falls through a documented fallback chain so synth
// always has *something* to call. A `unmappedAccent` log line surfaces in
// the cache layer's audit trail so we know to enrich the catalogue.

import { createHash } from "node:crypto";
import type {
  ListeningAccent,
  ListeningSpeaker,
  ListeningSpeakerRole,
} from "./content";

// Two role buckets cover every script line:
//   - "narration" — the Part-intro voice, the lecturer in Part 4. Steady,
//     paced, lower hesitation.
//   - "conversation" — the dialogues in Parts 1 and 3. More dynamic,
//     willing to overlap, friendlier register.
export type VoiceRole = "narration" | "conversation";

export function roleBucket(role: ListeningSpeakerRole): VoiceRole {
  // narrator + examiner share the "narration" bucket — both want a stable,
  // unhurried delivery. Only the in-script speakers get the conversational
  // bucket. (The examiner role doesn't currently appear in Listening
  // fixtures — Speaking owns that — but it's a safe default if it ever
  // does, because an examiner voice and a narrator voice want the same
  // register.)
  return role === "speaker" ? "conversation" : "narration";
}

// Catalogue: per accent, per role bucket, an ordered list of candidate
// voice ids. The picker indexes into this with a hash. New voices added
// at the END of the list keep existing (testId, speaker.id) → voice
// mappings stable — adding at the FRONT would re-roll every Test.
export type VoiceCatalogue = Record<
  ListeningAccent,
  Record<VoiceRole, string[]>
>;

// The defaults below are stock ElevenLabs voices (their canonical names in
// comments). Canadian and New Zealand entries are intentionally short —
// ElevenLabs' stock library has limited coverage there, so the picker's
// fallback chain (Canadian → American, New Zealand → Australian) carries
// most of the weight in v1.
export const DEFAULT_VOICE_CATALOGUE: VoiceCatalogue = {
  british: {
    narration: [
      "JBFqnCBsd6RMkjVDRZzb", // George — male, mature
      "onwK4e9ZLuTAKqWW03F9", // Daniel — male, narration
      "Xb7hH8MSUJpSbSDYk0k2", // Alice — female, narration
    ],
    conversation: [
      "pFZP5JQG7iQjIQuC4Bku", // Lily — female, conversational
      "ThT5KcBeYPX3keUQqHPh", // Dorothy — female, lively
    ],
  },
  american: {
    narration: [
      "21m00Tcm4TlvDq8ikWAM", // Rachel — female, narration
      "pNInz6obpgDQGcFmaJgB", // Adam — male, narration
      "VR6AewLTigWG4xSOukaG", // Arnold — male, mature
    ],
    conversation: [
      "EXAVITQu4vr4xnSDxMaL", // Bella — female, soft
      "ErXwobaYiN019PkySvjV", // Antoni — male, well-rounded
      "nPczCjzI2devNBz1zQrb", // Brian — male, deep
    ],
  },
  australian: {
    narration: [
      "IKne3meq5aSn9XLyUdCD", // Charlie — male, casual (used as narration fallback)
    ],
    conversation: [
      "IKne3meq5aSn9XLyUdCD", // Charlie — male, casual
    ],
  },
  canadian: {
    // No confident stock voices — picker falls through to American.
    narration: [],
    conversation: [],
  },
  "new-zealand": {
    // No confident stock voices — picker falls through to Australian.
    narration: [],
    conversation: [],
  },
};

// Documented fallback chain. When the catalogue has no candidates for a
// requested (accent, role), we walk this map. Picker never returns null.
const ACCENT_FALLBACKS: Record<ListeningAccent, ListeningAccent[]> = {
  british: ["american", "australian"],
  american: ["british", "australian"],
  australian: ["british", "american"],
  canadian: ["american", "british"],
  "new-zealand": ["australian", "british", "american"],
};

export type VoicePickerOptions = {
  catalogue?: VoiceCatalogue;
};

// Stable selection: hash (testId, speaker.id) → 32-bit unsigned int → index
// into the candidate list. SHA-256 is overkill for "evenly distribute
// across 2-3 voices" but it is dependency-free (node:crypto) and we know
// its distribution is uniform. The same (testId, speaker.id) always
// selects the same voice.
function pickIndex(testId: string, speakerId: string, modulus: number): number {
  const h = createHash("sha256").update(`${testId}\x00${speakerId}`).digest();
  // First 4 bytes as unsigned big-endian → integer in [0, 2^32).
  const n = h.readUInt32BE(0);
  return n % modulus;
}

// Resolves a (accent, role) to a candidate list, walking the fallback
// chain in order. Returns the list itself plus the accent that actually
// supplied it (so callers can log when we fell back).
function resolveCandidates(
  catalogue: VoiceCatalogue,
  accent: ListeningAccent,
  bucket: VoiceRole,
): { candidates: string[]; resolvedAccent: ListeningAccent } {
  const direct = catalogue[accent][bucket];
  if (direct.length > 0) return { candidates: direct, resolvedAccent: accent };
  for (const fb of ACCENT_FALLBACKS[accent]) {
    const list = catalogue[fb][bucket];
    if (list.length > 0) return { candidates: list, resolvedAccent: fb };
  }
  // Last resort: try the other bucket on the same accent before going on
  // a deeper hunt. A "narration" voice on a conversational line is less
  // bad than no voice at all.
  const otherBucket: VoiceRole =
    bucket === "narration" ? "conversation" : "narration";
  const sameAccentOther = catalogue[accent][otherBucket];
  if (sameAccentOther.length > 0) {
    return { candidates: sameAccentOther, resolvedAccent: accent };
  }
  for (const fb of ACCENT_FALLBACKS[accent]) {
    const list = catalogue[fb][otherBucket];
    if (list.length > 0) return { candidates: list, resolvedAccent: fb };
  }
  // Final fallback: any voice we have. The catalogue is hand-curated, so
  // this branch is reachable only if somebody empties the whole file.
  for (const a of Object.keys(catalogue) as ListeningAccent[]) {
    for (const b of ["narration", "conversation"] as VoiceRole[]) {
      const list = catalogue[a][b];
      if (list.length > 0) return { candidates: list, resolvedAccent: a };
    }
  }
  throw new Error("voice catalogue is empty — no candidates anywhere");
}

export type PickedVoice = {
  voice_id: string;
  // The accent that ACTUALLY supplied the voice. Equals `requested` on a
  // direct hit; differs when the picker fell back.
  requested: ListeningAccent;
  resolved: ListeningAccent;
  bucket: VoiceRole;
};

// Pick a voice for a speaker in a given test. The (testId, speaker.id)
// pair uniquely determines the choice — re-running TTS on the same Test
// always picks the same voices.
export function pickVoiceForSpeaker(
  speaker: ListeningSpeaker,
  testId: string,
  opts: VoicePickerOptions = {},
): PickedVoice {
  // An explicit voice_id on the speaker (set by SuperAdmin override at
  // moderation time, for example) wins over the catalogue.
  if (speaker.voice_id && speaker.voice_id.length > 0) {
    return {
      voice_id: speaker.voice_id,
      requested: speaker.accent,
      resolved: speaker.accent,
      bucket: roleBucket(speaker.role),
    };
  }
  const catalogue = opts.catalogue ?? DEFAULT_VOICE_CATALOGUE;
  const bucket = roleBucket(speaker.role);
  const { candidates, resolvedAccent } = resolveCandidates(
    catalogue,
    speaker.accent,
    bucket,
  );
  const idx = pickIndex(testId, speaker.id, candidates.length);
  // candidates is non-empty by resolveCandidates' contract.
  const voice_id = candidates[idx]!;
  return {
    voice_id,
    requested: speaker.accent,
    resolved: resolvedAccent,
    bucket,
  };
}

// Convenience: every accent in the catalogue, useful for sanity tests and
// for the SuperAdmin moderation UI's voice picker.
export function listAccents(): ListeningAccent[] {
  return [
    "british",
    "american",
    "australian",
    "canadian",
    "new-zealand",
  ];
}
