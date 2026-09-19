/**
 * Normalize and validate an Australian Business Number before it crosses the
 * billing boundary. Returns null for missing or checksum-invalid values.
 */
export function normalizeAustralianBusinessNumber(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const digits = value.replace(/\D/g, "");
  if (digits.length !== 11) return null;

  const weights = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  const checksum = digits
    .split("")
    .reduce((sum, digit, index) => {
      const adjustedDigit = Number(digit) - (index === 0 ? 1 : 0);
      return sum + adjustedDigit * weights[index];
    }, 0);

  return checksum % 89 === 0 ? digits : null;
}
