const MAX_ANCHOR_PATTERNS = 8;
const MAX_PATTERN_LENGTH = 128;
export const MAX_ANCHOR_MATCH_LENGTH = 2_048;

function isSafeAnchorPattern(pattern: string): boolean {
  if (!pattern || pattern.length > MAX_PATTERN_LENGTH) return false;

  let inClass = false;
  let escaped = false;
  let unboundedQuantifiers = 0;

  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (escaped) {
      // Backreferences can make regex execution non-linear.
      if (/[1-9]/.test(char)) return false;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '[') inClass = true;
    if (char === ']' && inClass) inClass = false;
    if (inClass) continue;

    // Disallow lookarounds and quantified groups. Both can hide ambiguous,
    // nested repetitions that are unsafe to run against fetched content.
    if (char === '(' && pattern[i + 1] === '?') return false;
    if (['*', '+', '?', '{'].includes(char)) {
      let previous = pattern[i - 1];
      if (previous === '?' && i > 1) previous = pattern[i - 2];
      if (!previous || previous === ')' || ['*', '+', '?', '}'].includes(previous)) return false;

      const isUnbounded = char === '*' || char === '+' || (char === '{' && /^\{\d+,\}/.test(pattern.slice(i)));
      if (isUnbounded && ++unboundedQuantifiers > 1) return false;
    }
  }

  return !escaped && !inClass;
}

export function compileAnchorPatterns(value: unknown): RegExp[] {
  if (!Array.isArray(value)) return [];
  const patterns: RegExp[] = [];
  for (const candidate of value.slice(0, MAX_ANCHOR_PATTERNS)) {
    if (typeof candidate !== 'string' || !isSafeAnchorPattern(candidate)) continue;
    try { patterns.push(new RegExp(candidate, 'i')); } catch { /* invalid pattern */ }
  }
  return patterns;
}
