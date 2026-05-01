// Client component for the add-note form. Calls a server action, shows
// success/error inline. Used on /customer/[id] and /job/[id].

"use client";

import { useState, useTransition } from "react";

type Action = (fd: FormData) => Promise<{ ok: true } | { ok: false; error: string }>;

export function NoteForm({
  action,
  hiddenFieldName,
  hiddenFieldValue,
  placeholder = "Add a note…",
  label = "Add note",
}: {
  action: Action;
  hiddenFieldName: string;
  hiddenFieldValue: string;
  placeholder?: string;
  label?: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    if (!String(fd.get("body") ?? "").trim()) {
      setError("Empty note");
      return;
    }
    startTransition(async () => {
      const res = await action(fd);
      if (res.ok) {
        setText("");
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-2">
      <input type="hidden" name={hiddenFieldName} value={hiddenFieldValue} />
      <textarea
        name="body"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        maxLength={10000}
        placeholder={placeholder}
        className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        disabled={isPending}
      />
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending || !text.trim()}
          className="rounded-md bg-brand-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-800 disabled:cursor-not-allowed disabled:bg-neutral-300"
        >
          {isPending ? "Saving…" : label}
        </button>
        <span className="text-xs text-neutral-500">
          {text.length}/10000
        </span>
        {error ? <span className="text-xs text-red-700">{error}</span> : null}
      </div>
    </form>
  );
}
