import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Voice-note audio is uploaded through a Server Action (VoiceNoteRecorder →
    // uploadVoiceNote). The default Server Action body limit is 1MB, which a
    // 15-90s recording easily exceeds — Next then rejects the POST before the
    // action runs, which surfaced as a generic "This page couldn't load" error
    // with no DB row and no edge-function invocation. Raise the limit.
    serverActions: {
      bodySizeLimit: "25mb",
    },
  },
};

export default nextConfig;
