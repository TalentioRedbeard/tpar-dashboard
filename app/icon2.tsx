// 512x512 PWA icon (Android adaptive icons, splash screens).
// Designed with a generous safe zone so the maskable variant doesn't
// crop the mark. Same brand identity.

import { ImageResponse } from "next/og";

export const runtime = "edge";
export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function IconXL() {
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
        {/* Mark + tagline are inside ~60% safe zone for maskable adaptive icons */}
        <div style={{ fontSize: 320, fontWeight: 800, letterSpacing: -14, lineHeight: 1, marginTop: -20 }}>T</div>
        <div style={{ fontSize: 64, fontWeight: 700, letterSpacing: 18, marginTop: 18, color: "#dbeafe" }}>PAR</div>
        <div
          style={{
            position: "absolute",
            bottom: 70,
            right: 76,
            width: 52,
            height: 52,
            borderRadius: 52,
            background: "#f59e0b",
            boxShadow: "0 0 0 10px rgba(255,255,255,0.18)",
          }}
        />
      </div>
    ),
    { ...size },
  );
}
