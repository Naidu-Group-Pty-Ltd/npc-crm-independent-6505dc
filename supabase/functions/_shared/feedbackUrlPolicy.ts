const FEEDBACK_ORIGIN = "https://aurixasystems.com.au";

/** Accept only links to the public Aurixa feedback site. */
export function validateFeedbackUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;

  try {
    const url = new URL(value);
    if (url.origin !== FEEDBACK_ORIGIN || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}
