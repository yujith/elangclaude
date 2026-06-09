import { describe, expect, it } from "vitest";
import {
  assertAudioKey,
  assertBrandingLogoKey,
  assertKeyBelongsToOrg,
  audioExtensionForMimeType,
  audioKey,
  brandingLogoKey,
  extensionForMimeType,
  logoExtensionForMimeType,
  recordingKey,
} from "./keys";

const SHA = "a".repeat(64);
const OTHER_SHA = "b".repeat(64);

describe("recordingKey", () => {
  it("prefixes org → user → attempt and ends in .webm", () => {
    expect(
      recordingKey({
        org_id: "org_1",
        user_id: "user_1",
        attempt_id: "att_1",
      }),
    ).toBe("recordings/org_1/user_1/att_1.webm");
  });

  it("accepts cuid-shaped ids", () => {
    expect(
      recordingKey({
        org_id: "clh1org0000000000000000000",
        user_id: "clh1usr0000000000000000000",
        attempt_id: "clh1att0000000000000000000",
      }),
    ).toBe(
      "recordings/clh1org0000000000000000000/clh1usr0000000000000000000/clh1att0000000000000000000.webm",
    );
  });

  it("rejects ids containing path separators (no traversal)", () => {
    expect(() =>
      recordingKey({ org_id: "../other", user_id: "u", attempt_id: "a" }),
    ).toThrow(/Unsafe org_id/);
    expect(() =>
      recordingKey({ org_id: "o", user_id: "u/../x", attempt_id: "a" }),
    ).toThrow(/Unsafe user_id/);
    expect(() =>
      recordingKey({ org_id: "o", user_id: "u", attempt_id: "a/b" }),
    ).toThrow(/Unsafe attempt_id/);
  });

  it("rejects empty or whitespace ids", () => {
    expect(() =>
      recordingKey({ org_id: "", user_id: "u", attempt_id: "a" }),
    ).toThrow();
    expect(() =>
      recordingKey({ org_id: "o", user_id: " ", attempt_id: "a" }),
    ).toThrow();
  });
});

describe("recordingKey — extension", () => {
  it("defaults to .webm when no extension is passed", () => {
    expect(
      recordingKey({ org_id: "org_1", user_id: "u", attempt_id: "a" }),
    ).toBe("recordings/org_1/u/a.webm");
  });

  it("uses .mp4 when requested", () => {
    expect(
      recordingKey({
        org_id: "org_1",
        user_id: "u",
        attempt_id: "a",
        extension: "mp4",
      }),
    ).toBe("recordings/org_1/u/a.mp4");
  });

  it("rejects an unsupported extension", () => {
    expect(() =>
      recordingKey({
        org_id: "org_1",
        user_id: "u",
        attempt_id: "a",
        // @ts-expect-error — exercising the runtime guard.
        extension: "ogg",
      }),
    ).toThrow(/Unsupported recording extension/);
  });
});

describe("extensionForMimeType", () => {
  it("maps audio/webm and its codec variants to webm", () => {
    expect(extensionForMimeType("audio/webm")).toBe("webm");
    expect(extensionForMimeType("audio/webm;codecs=opus")).toBe("webm");
    expect(extensionForMimeType("video/webm")).toBe("webm");
  });
  it("maps audio/mp4 family to mp4", () => {
    expect(extensionForMimeType("audio/mp4")).toBe("mp4");
    expect(extensionForMimeType("audio/m4a")).toBe("mp4");
    expect(extensionForMimeType("video/mp4")).toBe("mp4");
  });
  it("returns null for unsupported types", () => {
    expect(extensionForMimeType("audio/ogg")).toBeNull();
    expect(extensionForMimeType("application/pdf")).toBeNull();
    expect(extensionForMimeType("")).toBeNull();
  });
});

describe("assertKeyBelongsToOrg", () => {
  it("passes for a key under the org prefix", () => {
    expect(() =>
      assertKeyBelongsToOrg("recordings/org_1/u/a.webm", "org_1"),
    ).not.toThrow();
  });

  it("throws for a key from another org", () => {
    expect(() =>
      assertKeyBelongsToOrg("recordings/org_2/u/a.webm", "org_1"),
    ).toThrow(/not scoped to org org_1/);
  });

  it("throws for a key that only looks like a prefix match", () => {
    // org_10 must not satisfy a check for org_1.
    expect(() =>
      assertKeyBelongsToOrg("recordings/org_10/u/a.webm", "org_1"),
    ).toThrow();
  });

  it("rejects an unsafe org_id rather than building a bogus prefix", () => {
    expect(() =>
      assertKeyBelongsToOrg("recordings/x/u/a.webm", "../x"),
    ).toThrow(/Unsafe org_id/);
  });

  it("throws when handed an audio cache key", () => {
    // An audio key has no org_id in the prefix at all — flagging it as
    // "not scoped to org X" stops a caller from accidentally treating
    // a global object as if it were tenant-owned.
    expect(() =>
      assertKeyBelongsToOrg(`audio/${SHA}.mp3`, "org_1"),
    ).toThrow(/not scoped to org/);
  });
});

describe("audioKey", () => {
  it("builds an audio/{sha256}.{ext} path", () => {
    expect(audioKey({ sha256: SHA, extension: "mp3" })).toBe(
      `audio/${SHA}.mp3`,
    );
    expect(audioKey({ sha256: OTHER_SHA, extension: "wav" })).toBe(
      `audio/${OTHER_SHA}.wav`,
    );
  });

  it("rejects a non-hex / wrong-length sha256", () => {
    expect(() => audioKey({ sha256: "deadbeef", extension: "mp3" })).toThrow(
      /Unsafe sha256/,
    );
    expect(() =>
      audioKey({ sha256: "Z".repeat(64), extension: "mp3" }),
    ).toThrow(/Unsafe sha256/);
  });

  it("rejects an unsupported extension", () => {
    expect(() =>
      // @ts-expect-error — exercising the runtime guard.
      audioKey({ sha256: SHA, extension: "flac" }),
    ).toThrow(/Unsupported audio extension/);
  });
});

describe("assertAudioKey", () => {
  it("passes for a well-formed audio key", () => {
    expect(() => assertAudioKey(`audio/${SHA}.mp3`)).not.toThrow();
    expect(() => assertAudioKey(`audio/${SHA}.ogg`)).not.toThrow();
  });

  it("rejects a key under the recordings/ prefix", () => {
    expect(() => assertAudioKey("recordings/org_1/u/a.webm")).toThrow(
      /not an audio cache key/,
    );
  });

  it("rejects a key missing the sha256 segment", () => {
    expect(() => assertAudioKey("audio/not-a-hash.mp3")).toThrow(
      /does not embed a sha256/,
    );
  });

  it("rejects a key with no extension", () => {
    expect(() => assertAudioKey(`audio/${SHA}`)).toThrow(/no extension/);
  });

  it("rejects an unsupported extension", () => {
    expect(() => assertAudioKey(`audio/${SHA}.flac`)).toThrow(
      /unsupported extension/,
    );
  });
});

describe("audioExtensionForMimeType", () => {
  it("maps mpeg/mp3 to mp3", () => {
    expect(audioExtensionForMimeType("audio/mpeg")).toBe("mp3");
    expect(audioExtensionForMimeType("audio/mp3")).toBe("mp3");
  });

  it("maps wav family to wav", () => {
    expect(audioExtensionForMimeType("audio/wav")).toBe("wav");
    expect(audioExtensionForMimeType("audio/x-wav")).toBe("wav");
  });

  it("maps ogg to ogg", () => {
    expect(audioExtensionForMimeType("audio/ogg")).toBe("ogg");
    expect(audioExtensionForMimeType("application/ogg")).toBe("ogg");
  });

  it("returns null for unsupported types", () => {
    expect(audioExtensionForMimeType("audio/flac")).toBeNull();
    expect(audioExtensionForMimeType("text/plain")).toBeNull();
    expect(audioExtensionForMimeType("")).toBeNull();
  });
});

describe("brandingLogoKey", () => {
  it("builds the org-prefixed logo key", () => {
    expect(brandingLogoKey({ org_id: "org_1", extension: "png" })).toBe(
      "branding/org_1/logo.png",
    );
    expect(brandingLogoKey({ org_id: "org_1", extension: "webp" })).toBe(
      "branding/org_1/logo.webp",
    );
  });

  it("rejects unsafe org ids", () => {
    expect(() =>
      brandingLogoKey({ org_id: "../other", extension: "png" }),
    ).toThrow(/Unsafe org_id/);
    expect(() =>
      brandingLogoKey({ org_id: "a/b", extension: "png" }),
    ).toThrow(/Unsafe org_id/);
  });

  it("rejects unsupported extensions (svg above all)", () => {
    expect(() =>
      // @ts-expect-error — deliberately wrong extension
      brandingLogoKey({ org_id: "org_1", extension: "svg" }),
    ).toThrow(/Unsupported logo extension/);
  });
});

describe("assertBrandingLogoKey", () => {
  it("accepts a key under the caller's org", () => {
    expect(() =>
      assertBrandingLogoKey("branding/org_1/logo.png", "org_1"),
    ).not.toThrow();
  });

  it("rejects another org's key", () => {
    expect(() =>
      assertBrandingLogoKey("branding/org_1/logo.png", "org_2"),
    ).toThrow(/not a branding key for org org_2/);
  });

  it("rejects recording and audio keys outright", () => {
    expect(() =>
      assertBrandingLogoKey("recordings/org_1/u/a.webm", "org_1"),
    ).toThrow(/not a branding key/);
    expect(() =>
      assertBrandingLogoKey(`audio/${"a".repeat(64)}.mp3`, "org_1"),
    ).toThrow(/not a branding key/);
  });

  it("rejects non-logo shapes under the branding prefix", () => {
    expect(() =>
      assertBrandingLogoKey("branding/org_1/evil.html", "org_1"),
    ).toThrow(/not a valid branding logo key/);
    expect(() =>
      assertBrandingLogoKey("branding/org_1/logo.svg", "org_1"),
    ).toThrow(/not a valid branding logo key/);
  });
});

describe("logoExtensionForMimeType", () => {
  it("maps the three raster types", () => {
    expect(logoExtensionForMimeType("image/png")).toBe("png");
    expect(logoExtensionForMimeType("image/jpeg")).toBe("jpg");
    expect(logoExtensionForMimeType("image/webp")).toBe("webp");
  });

  it("rejects SVG and everything else", () => {
    expect(logoExtensionForMimeType("image/svg+xml")).toBeNull();
    expect(logoExtensionForMimeType("image/gif")).toBeNull();
    expect(logoExtensionForMimeType("text/html")).toBeNull();
  });
});
