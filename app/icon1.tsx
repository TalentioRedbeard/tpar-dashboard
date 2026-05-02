// 192x192 PWA icon (Android home screen, splash, install banner).
// Same brand mark as apple-icon, scaled.

import { ImageResponse } from "next/og";

export const runtime = "edge";
export const size = { width: 192, height: 192 };
export const contentType = "image/png";

export default function IconLg() {
  return new ImageResponse(
    (
      <div
        style={{
          background: "#1e40af",
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          color: "#ffffff",
          fontFamily: "system-ui",
          position: "relative",
        }}
      >
        <div style={{ fontSize: 120, fontWeight: 800, letterSpacing: -5, lineHeight: 1, marginTop: -8 }}>T</div>
        <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: 7, marginTop: 8, color: "#dbeafe" }}>PAR</div>
        <div
          style={{
            position: "absolute",
            bottom: 24,
            right: 26,
            width: 20,
            height: 20,
            borderRadius: 20,
            background: "#f59e0b",
            boxShadow: "0 0 0 4px rgba(255,255,255,0.18)",
          }}
        />
      </div>
    ),
    { ...size },
  );
}
