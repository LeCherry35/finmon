/** `data:image/jpeg;base64,...` → decoded bytes + mime, or null when the URL
 *  isn't a base64 image data URL (nothing storable). */
export function parseImageDataUrl(
  dataUrl: string,
): { bytes: Buffer; contentType: string } | null {
  const m = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(dataUrl);
  if (!m) return null;
  return { bytes: Buffer.from(m[2], "base64"), contentType: m[1].toLowerCase() };
}

/** Stored bytes + mime → a `data:` URL again (what the vision call takes). */
export function toImageDataUrl(bytes: Buffer, contentType: string): string {
  return `data:${contentType};base64,${bytes.toString("base64")}`;
}
