// Magic-byte sniffing for org logo uploads (ADR-0023).
//
// The browser-declared MIME type is attacker-controlled, so the upload
// action verifies the actual bytes before anything lands in R2. PURE —
// unit-tested alongside keys.ts. Deliberately allowlist-shaped: anything
// that isn't recognisably PNG / JPEG / WebP (notably SVG, which can embed
// script) returns null.

export type SniffedImageType = {
  contentType: "image/png" | "image/jpeg" | "image/webp";
  extension: "png" | "jpg" | "webp";
};

export function sniffImageType(bytes: Uint8Array): SniffedImageType | null {
  if (bytes.length >= 8) {
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (png.every((b, i) => bytes[i] === b)) {
      return { contentType: "image/png", extension: "png" };
    }
  }
  if (bytes.length >= 3) {
    // JPEG: FF D8 FF
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      return { contentType: "image/jpeg", extension: "jpg" };
    }
  }
  if (bytes.length >= 12) {
    // WebP: "RIFF" <size> "WEBP"
    const ascii = (i: number) => String.fromCharCode(bytes[i]!);
    const tag = (start: number) =>
      ascii(start) + ascii(start + 1) + ascii(start + 2) + ascii(start + 3);
    if (tag(0) === "RIFF" && tag(8) === "WEBP") {
      return { contentType: "image/webp", extension: "webp" };
    }
  }
  return null;
}
