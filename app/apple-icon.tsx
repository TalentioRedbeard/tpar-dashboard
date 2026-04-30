// iOS home-screen icon (180x180). Used when Danny adds the dashboard to his
// home screen. Generated dynamically — same idea as app/icon.tsx, larger.

import { ImageResponse } from "next/og";

export const runtime = "edge";
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          background: "#171717",
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          color: "#fafafa",
          fontFamily: "system-ui",
        }}
      >
        <div style={{ fontSize: 92, fontWeight: 800, letterSpacing: -4, lineHeight: 1 }}>T</div>
        <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: 6, marginTop: 4, color: "#a3a3a3" }}>
          PAR
        </div>
      </div>
    ),
    { ...size },
  );
}
