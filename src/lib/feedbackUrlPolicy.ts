const FEEDBACK_ORIGIN = "https://aurixasystems.com.au";

/** Defensively constrain feedback handoffs received by the browser. */
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
