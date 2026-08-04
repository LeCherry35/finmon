"use client";

import { useActionState, useEffect, useState } from "react";
import { submitBugReport } from "@/actions/bug-reports";

export default function BugReportButton() {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(submitBugReport, {
    successCount: 0,
  });
  const [lastSeenSuccess, setLastSeenSuccess] = useState(0);

  if (state.successCount !== lastSeenSuccess) {
    setLastSeenSuccess(state.successCount);
    if (state.successCount > 0) setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Report a bug"
        title="Report a bug"
        className="inline-flex min-w-10 min-h-10 items-center justify-center text-zinc-400 hover:text-zinc-700"
      >
        <BugIcon />
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/40"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Report a bug"
            className="fixed left-1/2 top-1/2 z-50 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg bg-white border border-zinc-200 shadow-lg"
          >
            <div className="flex items-center justify-between px-4 pt-3 pb-2">
              <h2 className="text-base font-semibold">Report a bug</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="w-10 h-10 -mr-2 flex items-center justify-center text-zinc-400 hover:text-zinc-700"
              >
                <XIcon />
              </button>
            </div>
            <form
              key={state.successCount}
              action={formAction}
              className="px-4 pb-4 space-y-3"
            >
              <textarea
                name="message"
                rows={5}
                autoFocus
                placeholder="What went wrong?"
                className="w-full border border-zinc-300 rounded px-3 py-2 text-base md:text-sm focus:outline-none focus:ring-1 focus:ring-zinc-400 resize-y"
              />
              {state.error && <p className="text-sm text-red-600">{state.error}</p>}
              <button
                type="submit"
                disabled={pending}
                className="w-full bg-zinc-900 text-white text-sm font-medium px-4 py-2 rounded hover:bg-zinc-700 disabled:opacity-50"
              >
                {pending ? "Sending…" : "Send report"}
              </button>
            </form>
          </div>
        </>
      )}
    </>
  );
}

function BugIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 7V6a4 4 0 0 1 8 0v1" />
      <rect x="7" y="7" width="10" height="12" rx="5" />
      <line x1="12" y1="7" x2="12" y2="19" />
      <line x1="2" y1="13" x2="7" y2="13" />
      <line x1="17" y1="13" x2="22" y2="13" />
      <line x1="4" y1="6" x2="8" y2="9" />
      <line x1="20" y1="6" x2="16" y2="9" />
      <line x1="4" y1="20" x2="8" y2="17" />
      <line x1="20" y1="20" x2="16" y2="17" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
