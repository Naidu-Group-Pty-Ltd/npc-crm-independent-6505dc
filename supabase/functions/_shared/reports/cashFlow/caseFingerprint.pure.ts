/**
 * A short, deterministic fingerprint of the inputs a cash-flow projection was
 * built from, so two documents can say whether they describe one case.
 *
 * The audit of 291 Stone Mason Drive (QA-02) found six documents that agreed
 * on nothing they did not disclose: the narrative model ran at 6.5%, 7.5% fees,
 * 50 weeks and $10,000 depreciation; the standalone cash flow at 5.5%, 7%, 52
 * weeks and $6,000 — with no scenario name and no way for a reader to tell
 * which was approved. The fingerprint is printed on the cash-flow document's
 * input summary; a reader comparing two documents whose fingerprints differ
 * knows they are not the same case before comparing a single figure.
 *
 * FNV-1a over a canonical JSON of the inputs, rendered as eight hex digits.
 * Not a security primitive — a label.
 */

export function caseInputsFingerprint(inputs: Record<string, unknown>): string {
  const keys = Object.keys(inputs).sort();
  const canonical = JSON.stringify(keys.map((k) => [k, normalise(inputs[k])]));
  let hash = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i += 1) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function normalise(v: unknown): unknown {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 10000) / 10000 : null;
  if (v === undefined) return null;
  return v;
}
