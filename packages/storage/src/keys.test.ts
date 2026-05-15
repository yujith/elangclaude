import { describe, expect, it } from "vitest";
import {
  assertKeyBelongsToOrg,
  extensionForMimeType,
  recordingKey,
} from "./keys";

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
});
