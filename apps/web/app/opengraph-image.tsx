import { ImageResponse } from "next/og";

export const alt = "eLanguage Center — Skills That Open Doorways";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#0A0A0A",
          color: "#FFFFFF",
          padding: 80,
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              width: 22,
              height: 56,
              background: "#EE2346",
              borderRadius: 4,
            }}
          />
          <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: -0.5 }}>
            eLanguage Center
          </div>
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 110,
            fontWeight: 800,
            fontStyle: "italic",
            lineHeight: 1.02,
            letterSpacing: -3,
            textTransform: "uppercase",
          }}
        >
          Skills that
          <br />
          open doorways
        </div>
        <div
          style={{
            display: "flex",
            gap: 18,
            fontSize: 26,
            fontWeight: 700,
            letterSpacing: 6,
          }}
        >
          <span>FREE</span>
          <span style={{ color: "#EE2346" }}>·</span>
          <span>FUN</span>
          <span style={{ color: "#EE2346" }}>·</span>
          <span>EFFECTIVE</span>
        </div>
      </div>
    ),
    { ...size },
  );
}
