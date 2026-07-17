"use client";

import { useState } from "react";

// Board / Map+Queues toggle for /dispatch (Dispatch×Schedule Merge, Segment 3).
// Receives both subtrees pre-rendered on the server (Server Components passed as
// props) and flips which is visible. Both stay mounted (CSS-hidden) so the map
// keeps its state and the board doesn't re-fetch on every switch. Defaults to
// Map + Queues — the historical dispatch cockpit — so nothing changes for existing
// muscle memory until a dispatcher opts into the Board.
export function DispatchViewToggle({
  board,
  mapQueues,
}: {
  board: React.ReactNode;
  mapQueues: React.ReactNode;
}) {
  const [view, setView] = useState<"map" | "board">("map");
  return (
    <>
      <div className="mb-3 inline-flex items-center gap-0.5 rounded-lg border border-neutral-200 bg-white p-0.5 text-sm">
        <button
          type="button"
          onClick={() => setView("map")}
          className={`rounded-md px-3 py-1.5 font-medium transition-colors ${view === "map" ? "bg-brand-100 text-brand-900" : "text-neutral-600 hover:bg-neutral-100"}`}
          aria-pressed={view === "map"}
        >
          🗺️ Map + Queues
        </button>
        <button
          type="button"
          onClick={() => setView("board")}
          className={`rounded-md px-3 py-1.5 font-medium transition-colors ${view === "board" ? "bg-brand-100 text-brand-900" : "text-neutral-600 hover:bg-neutral-100"}`}
          aria-pressed={view === "board"}
        >
          🗓️ Board
        </button>
      </div>
      <div className={view === "board" ? undefined : "hidden"}>{board}</div>
      <div className={view === "map" ? undefined : "hidden"}>{mapQueues}</div>
    </>
  );
}
