"use client";

// Fires once on mount to mark the whiteboard "seen" (clears the nav badge).
// Renders nothing. No-ops server-side while impersonating.

import { useEffect } from "react";
import { markWhiteboardSeen } from "../app/notes/board-actions";

export function MarkWhiteboardSeen() {
  useEffect(() => {
    void markWhiteboardSeen();
  }, []);
  return null;
}
