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

/** Compact, controlled receipt picker: an "Upload receipt" label over a hidden
 *  (nameless — so it never rides along in the create form's own submission) file
 *  input, plus the staged filename and a clear button. The parent owns the
 *  staged image and decides what the scan action does. */
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

  return (
    <div className="flex items-center gap-2 text-sm min-w-0">
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        disabled={disabled}
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
      <label
        htmlFor={inputId}
        className={`shrink-0 cursor-pointer inline-flex items-center gap-1.5 text-zinc-600 hover:text-zinc-900 ${
          disabled ? "pointer-events-none opacity-50" : ""
        }`}
      >
        <UploadIcon />
        {value ? "Change" : "Upload receipt"}
      </label>
      {value && (
        <span className="inline-flex items-center gap-1 min-w-0">
          <span className="truncate max-w-[9rem] text-zinc-500">{value.name}</span>
          <button
            type="button"
            onClick={clear}
            aria-label="Remove receipt"
            className="shrink-0 text-zinc-400 hover:text-red-500"
          >
            <XIcon />
          </button>
        </span>
      )}
    </div>
  );
}

function UploadIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
