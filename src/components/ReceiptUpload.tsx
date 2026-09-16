"use client";

import { useId, useRef } from "react";

export type StagedImage = { dataUrl: string; name: string };

/** Read a chosen image file into a `data:` URL, downscaling large photos via a
 *  canvas so the upload stays under the server-action body limit and costs fewer
 *  vision tokens. Falls back to the raw data URL when canvas / createImageBitmap
 *  isn't available (old browsers, or jsdom under tests). */
export async function fileToDataUrl(file: File): Promise<string> {
  try {
    if (typeof createImageBitmap !== "function") throw new Error("no bitmap");
    const bitmap = await createImageBitmap(file);
    const maxDim = 1280;
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    return canvas.toDataURL("image/jpeg", 0.7);
  } catch {
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error ?? new Error("read failed"));
      reader.readAsDataURL(file);
    });
  }
}

/** The "Scan receipt" hero tile — the app's headline feature, so it leads the
 *  create form. A controlled picker: a label over a visually hidden (and
 *  nameless — so it never rides along in the create form's own submission) file
 *  input. Empty, it's a dashed tile with a camera badge; once a photo is staged
 *  it becomes a solid card with a thumbnail, "Change" and a remove button, at
 *  the same height so the form doesn't jump. The parent owns the staged image
 *  and decides what the scan action does. */
export default function ReceiptUpload({
  value,
  onChange,
  disabled,
}: {
  value: StagedImage | null;
  onChange: (img: StagedImage | null) => void;
  disabled?: boolean;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    const dataUrl = await fileToDataUrl(file);
    onChange({ dataUrl, name: file.name });
  }

  function clear() {
    onChange(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  const input = (
    <input
      ref={inputRef}
      id={inputId}
      type="file"
      accept="image/*"
      capture="environment"
      className="peer sr-only"
      disabled={disabled}
      onChange={(e) => handleFile(e.target.files?.[0])}
    />
  );
  const off = disabled ? "pointer-events-none opacity-50" : "";

  if (!value) {
    return (
      <div className={`relative ${off}`}>
        {input}
        <label
          htmlFor={inputId}
          className="group flex w-full cursor-pointer items-center gap-3 rounded-xl border border-dashed border-zinc-300 bg-zinc-50/60 px-4 py-3 transition-colors hover:border-zinc-400 hover:bg-zinc-100/70 peer-focus-visible:ring-2 peer-focus-visible:ring-zinc-400"
        >
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-zinc-900 text-white shadow-sm transition-transform group-hover:scale-105 group-active:scale-95">
            <CameraIcon />
          </span>
          <span className="flex min-w-0 flex-col text-left">
            <span className="text-sm font-medium text-zinc-900">Scan receipt</span>
            <span className="truncate text-xs text-zinc-500">
              Fills products, store &amp; date
            </span>
          </span>
        </label>
      </div>
    );
  }

  return (
    <div
      className={`relative flex items-center gap-3 rounded-xl border border-zinc-200 bg-white py-3 pl-3 pr-1 ${off}`}
    >
      {input}
      {/* eslint-disable-next-line @next/next/no-img-element -- local data: URL preview */}
      <img
        src={value.dataUrl}
        alt="Staged receipt"
        className="size-10 shrink-0 rounded-lg border border-zinc-200 object-cover"
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium text-zinc-900">{value.name}</span>
        <span className="text-xs text-zinc-500">Ready to scan</span>
      </span>
      <label
        htmlFor={inputId}
        className="shrink-0 cursor-pointer rounded-md px-2 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 peer-focus-visible:ring-2 peer-focus-visible:ring-zinc-400"
      >
        Change
      </label>
      <button
        type="button"
        onClick={clear}
        aria-label="Remove receipt"
        className="inline-flex size-10 shrink-0 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-red-500"
      >
        <XIcon />
      </button>
    </div>
  );
}

/** Divider between the scan tile and the manual fields. */
export function ManualEntryDivider() {
  return (
    <div className="flex items-center gap-3 text-xs text-zinc-400" aria-hidden>
      <span className="h-px flex-1 bg-zinc-200" />
      or enter manually
      <span className="h-px flex-1 bg-zinc-200" />
    </div>
  );
}

function CameraIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
