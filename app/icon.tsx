// Browser favicon (32x32). Brand-mark — deep blue square, white T,
// amber accent dot. Generated at request time via Next.js ImageResponse.

import { ImageResponse } from "next/og";

export const runtime = "edge";
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          background: "#1e40af",            // brand-700
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#ffffff",
          fontWeight: 800,
          fontSize: 22,
          letterSpacing: -1,
          fontFamily: "system-ui",
          borderRadius: 6,
          position: "relative",
        }}
      >
        T
        <div
          style={{
            position: "absolute",
            bottom: 4,
            right: 5,
            width: 5,
            height: 5,
            borderRadius: 5,
            background: "#f59e0b",          // accent-500
          }}
        />
      </div>
    ),
    { ...size },
  );
}
