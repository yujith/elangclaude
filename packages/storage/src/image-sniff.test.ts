import { describe, expect, it } from "vitest";
import { sniffImageType } from "./image-sniff";

function bytes(...values: (number | string)[]): Uint8Array {
  const out: number[] = [];
  for (const v of values) {
    if (typeof v === "number") out.push(v);
    else for (const ch of v) out.push(ch.charCodeAt(0));
  }
  // Pad so length checks don't short-circuit the format tests.
  while (out.length < 16) out.push(0);
  return Uint8Array.from(out);
}

describe("sniffImageType", () => {
  it("recognises PNG", () => {
    expect(
      sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)),
    ).toEqual({ contentType: "image/png", extension: "png" });
  });

  it("recognises JPEG", () => {
    expect(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0))).toEqual({
      contentType: "image/jpeg",
      extension: "jpg",
    });
  });

  it("recognises WebP (RIFF....WEBP)", () => {
    expect(sniffImageType(bytes("RIFF", 0, 0, 0, 0, "WEBP"))).toEqual({
      contentType: "image/webp",
      extension: "webp",
    });
  });

  it("rejects SVG — even with an image-ish MIME the bytes are XML", () => {
    expect(sniffImageType(bytes("<svg xmlns="))).toBeNull();
    expect(sniffImageType(bytes("<?xml versi"))).toBeNull();
  });

  it("rejects GIF, HTML, and empty buffers", () => {
    expect(sniffImageType(bytes("GIF89a"))).toBeNull();
    expect(sniffImageType(bytes("<!DOCTYPE h"))).toBeNull();
    expect(sniffImageType(Uint8Array.from([]))).toBeNull();
  });

  it("rejects a RIFF container that isn't WebP (e.g. WAV)", () => {
    expect(sniffImageType(bytes("RIFF", 0, 0, 0, 0, "WAVE"))).toBeNull();
  });
});
