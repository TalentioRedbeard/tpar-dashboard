// IndexedDB-backed storage for voice-note recordings. Saved blobs survive
// page reloads, navigations, and upload failures (the 404 case Danny hit
// 2026-05-13 where the recording was lost when the upload errored). Cleared
// on successful upload.
//
// Why IndexedDB and not localStorage: localStorage is string-only with a ~5MB
// cap. Audio blobs (15-90 seconds of webm/opus) are typically 100KB-1.5MB and
// must be stored as binary. IndexedDB handles Blob natively.

const DB_NAME = "tpar-voice-notes";
const DB_VERSION = 1;
const STORE = "pending";

export type PendingRecordingMeta = {
  hcpJobId?: string;
  hcpCustomerId?: string;
  intentTag?: string;
  needsDiscussion?: boolean;
  source?: string;
};

export type PendingRecording = {
  id: string;
  blob: Blob;
  metadata: PendingRecordingMeta;
  recordedAt: number;     // epoch ms
  durationMs: number;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable (SSR or unsupported browser)"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveRecording(rec: Omit<PendingRecording, "id">): Promise<string> {
  const db = await openDb();
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({ ...rec, id });
    tx.oncomplete = () => { db.close(); resolve(id); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export async function clearRecording(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export async function listPendingRecordings(): Promise<PendingRecording[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => {
      db.close();
      const rows = (req.result || []) as PendingRecording[];
      // Newest first.
      rows.sort((a, b) => b.recordedAt - a.recordedAt);
      resolve(rows);
    };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

// Safety net: prune anything older than 7 days. The dashboard runs this on
// mount of the recorder so abandoned recordings don't accumulate forever.
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export async function pruneOldRecordings(): Promise<number> {
  const all = await listPendingRecordings();
  const cutoff = Date.now() - MAX_AGE_MS;
  const stale = all.filter((r) => r.recordedAt < cutoff);
  for (const r of stale) {
    await clearRecording(r.id).catch(() => { /* ignore */ });
  }
  return stale.length;
}
