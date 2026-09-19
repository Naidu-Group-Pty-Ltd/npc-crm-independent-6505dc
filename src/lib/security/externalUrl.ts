/** Return a canonical absolute HTTP(S) URL, or null when the value is unsafe. */
export function normalizeExternalUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;

  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}
