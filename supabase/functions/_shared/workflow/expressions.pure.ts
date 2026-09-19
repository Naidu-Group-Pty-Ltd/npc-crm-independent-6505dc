/**
 * `{{step.key}}` resolution.
 *
 * Two shapes, deliberately:
 *   "{{search.results}}"              → the value itself, keeping its type
 *   "Hi {{client.firstName}}, ..."    → the value coerced into the string
 *
 * The first matters because a loop needs a real array, not "[object Object]".
 * A field whose whole content is one reference passes the value through; any
 * surrounding text makes it interpolation.
 */

export type Scope = Record<string, Record<string, unknown>>;

/** Matches a whole-string reference, e.g. `{{step_1.email}}` with nothing else. */
const WHOLE = /^\s*\{\{\s*([\w-]+)\.([\w.-]+)\s*\}\}\s*$/;
const ANY = /\{\{\s*([\w-]+)\.([\w.-]+)\s*\}\}/g;

/** `Object.hasOwn` is newer than this project's TS lib target. */
const hasOwn = (target: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(target, key);

/** Walks a dotted path, own properties only. */
function readPath(source: unknown, path: string): unknown {
  let current = source;
  for (const segment of path.split('.')) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index)) return undefined;
      current = current[index];
      continue;
    }
    if (typeof current !== 'object') return undefined;
    // Own properties only — a path must never reach through the prototype.
    if (!hasOwn(current, segment)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

export function lookup(scope: Scope, stepId: string, path: string): unknown {
  if (!hasOwn(scope, stepId)) return undefined;
  return readPath(scope[stepId], path);
}

/** How an unresolved reference renders when interpolated into text. */
const MISSING = '';

const stringify = (value: unknown): string => {
  if (value === null || value === undefined) return MISSING;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

export interface ResolveResult {
  value: unknown;
  /** References that resolved to nothing — surfaced as run warnings. */
  missing: string[];
}

/** Resolves one configured value against the run's scope. */
export function resolveValue(input: unknown, scope: Scope): ResolveResult {
  const missing: string[] = [];

  if (Array.isArray(input)) {
    const value = input.map((item) => {
      const resolved = resolveValue(item, scope);
      missing.push(...resolved.missing);
      return resolved.value;
    });
    return { value, missing };
  }

  if (input && typeof input === 'object') {
    const value: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(input as Record<string, unknown>)) {
      const resolved = resolveValue(item, scope);
      missing.push(...resolved.missing);
      value[key] = resolved.value;
    }
    return { value, missing };
  }

  if (typeof input !== 'string') return { value: input, missing };

  const whole = input.match(WHOLE);
  if (whole) {
    const found = lookup(scope, whole[1], whole[2]);
    if (found === undefined) missing.push(`${whole[1]}.${whole[2]}`);
    return { value: found, missing };
  }

  const value = input.replace(ANY, (_match, stepId: string, path: string) => {
    const found = lookup(scope, stepId, path);
    if (found === undefined) missing.push(`${stepId}.${path}`);
    return stringify(found);
  });

  return { value, missing };
}

/** Resolves every field on a step's config. */
export function resolveConfig(
  config: Record<string, unknown>,
  scope: Scope,
): { config: Record<string, unknown>; missing: string[] } {
  const resolved = resolveValue(config, scope);
  return { config: resolved.value as Record<string, unknown>, missing: [...new Set(resolved.missing)] };
}

export type ComparisonOperator =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'lt'
  | 'contains'
  | 'exists'
  | 'empty';

/**
 * The comparison behind branch, filter and poll.
 *
 * Numeric comparisons coerce, because a value arriving from an API as "42" and
 * one arriving as 42 should behave the same; equality does not, so `0` and `''`
 * stay distinguishable.
 */
export function compare(left: unknown, operator: ComparisonOperator, right?: unknown): boolean {
  const isBlank = (v: unknown) =>
    v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

  switch (operator) {
    case 'exists':
      return !isBlank(left);
    case 'empty':
      return isBlank(left);
    case 'eq':
      return String(left ?? '') === String(right ?? '');
    case 'neq':
      return String(left ?? '') !== String(right ?? '');
    case 'gt':
      return Number(left) > Number(right);
    case 'lt':
      return Number(left) < Number(right);
    case 'contains': {
      if (Array.isArray(left)) return left.some((item) => String(item) === String(right));
      return String(left ?? '').toLowerCase().includes(String(right ?? '').toLowerCase());
    }
    default:
      return false;
  }
}

/** `30m`, `4h`, `2d`, `45s` → milliseconds. Returns null when unparseable. */
export function parseDuration(input: unknown): number | null {
  if (typeof input === 'number' && Number.isFinite(input)) return input;
  if (typeof input !== 'string') return null;

  const match = input.trim().match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)$/i);
  if (!match) return null;

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const scale: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return amount * (scale[unit] ?? 0);
}
