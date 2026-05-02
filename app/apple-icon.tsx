// iOS home-screen icon (180x180). Used when a tech adds the dashboard
// to their home screen on iPhone/iPad. Generated dynamically.

import { ImageResponse } from "next/og";

export const runtime = "edge";
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          background: "#1e40af",            // brand-700
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
        <div
          style={{
            fontSize: 110,
            fontWeight: 800,
            letterSpacing: -5,
            lineHeight: 1,
            marginTop: -6,
          }}
        >
          T
        </div>
        <div
          style={{
            fontSize: 22,
            fontWeight: 700,
            letterSpacing: 6,
            marginTop: 6,
            color: "#dbeafe",               // brand-100
          }}
        >
          PAR
        </div>
        <div
          style={{
            position: "absolute",
            bottom: 22,
            right: 24,
            width: 18,
            height: 18,
            borderRadius: 18,
            background: "#f59e0b",          // accent-500
            boxShadow: "0 0 0 4px rgba(255,255,255,0.18)",
          }}
        />
      </div>
    ),
    { ...size },
  );
}
