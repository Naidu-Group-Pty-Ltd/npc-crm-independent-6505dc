/**
 * Turning a catalog step's request descriptor into an actual HTTP call.
 *
 * ## Why this is data and not code
 *
 * Live execution used to cover 8 of 252 catalog operations, and the way to
 * cover the ninth was to write another `case` in the executor. That does not
 * finish: the catalog is a list of real vendor operations, and hand-writing an
 * executor for each is 244 more functions, each with its own chance to leak a
 * credential into a log or forget metering.
 *
 * Almost none of that work is interesting. "Send an SMS" and "post to Slack"
 * differ by a URL, an auth style, a body shape and where the id comes back —
 * four pieces of data. So the catalog carries the data and this module turns it
 * into a request. One executor performs every operation that has a descriptor,
 * so adding a vendor is a declaration next to the operation it describes rather
 * than a change to the thing that runs it.
 *
 * ## The template language, and why it is this small
 *
 * `{{name}}` reads the step's resolved config. `{{secret.KEY}}` reads a saved
 * credential. That is the whole substitution vocabulary, plus two things that
 * exist because leaving them out forces every descriptor to work around them:
 *
 *   • **`{{name|object}}`** — a `keyValue` field is edited as `{key,value}[]`
 *     and almost every API wants an object. Without this, Airtable's `fields`
 *     could not be expressed at all.
 *   • **candidate arrays** — `['{{from}}', '{{secret.TWILIO_FROM_NUMBER}}']`
 *     takes the first that resolves to something. A per-step override falling
 *     back to an integration default is common enough that expressing it any
 *     other way means a special case in the executor.
 *
 * A template that is exactly one reference yields the *value*, not a string:
 * `{{payload}}` where payload is an object stays an object. Anything else is
 * string interpolation. Without that rule a JSON body could only ever contain
 * strings.
 *
 * ## What this module refuses to do
 *
 * It does not fetch, and it does not read the environment. It returns a plain
 * description of a request, which is what makes every rule here testable
 * without a network or a vendor account — and every rule here is one that is
 * silently wrong in production otherwise: a missing credential, an interpolated
 * `undefined` reaching a customer's SMS, a secret pasted into a URL that gets
 * logged.
 */

import type { CatalogNode, NodeAuth, NodeRequest } from './types.pure.ts';

export interface BuiltRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
  /**
   * Credential values that appear anywhere in the request, so a caller can keep
   * them out of logs and stored step output. Never empty strings — those would
   * redact everything.
   */
  secretValues: string[];
}

export interface BuildFailure {
  /** Credential keys the descriptor needs and the workspace has not saved. */
  missingSecrets: string[];
  error: string;
}

export type BuildResult =
  | { ok: true; request: BuiltRequest }
  | { ok: false; failure: BuildFailure };

/** `{{ name }}` or `{{ secret.KEY }}`, with an optional `|object` transform. */
const REFERENCE = /\{\{\s*([a-zA-Z0-9_.$]+)\s*(?:\|\s*([a-z]+)\s*)?\}\}/g;

const isBlank = (value: unknown): boolean =>
  value === undefined || value === null || value === '' ||
  (Array.isArray(value) && value.length === 0);

/** `{key,value}[]` → `{ key: value }`. Rows with no name are dropped. */
function pairsToObject(value: unknown): Record<string, unknown> {
  if (!Array.isArray(value)) return {};
  const out: Record<string, unknown> = {};
  for (const pair of value as { key?: unknown; value?: unknown }[]) {
    const key = typeof pair?.key === 'string' ? pair.key.trim() : '';
    if (key) out[key] = pair?.value ?? '';
  }
  return out;
}

interface Scope {
  config: Record<string, unknown>;
  secrets: Record<string, string>;
  /** Every secret key a resolution touched, so the caller can redact them. */
  usedSecrets: Set<string>;
  /** Secret keys referenced but absent. */
  missing: Set<string>;
}

function lookup(path: string, scope: Scope): unknown {
  if (path.startsWith('secret.')) {
    const key = path.slice('secret.'.length);
    const value = scope.secrets[key];
    if (isBlank(value)) {
      scope.missing.add(key);
      return undefined;
    }
    scope.usedSecrets.add(key);
    return value;
  }
  // Dotted paths into config, so a descriptor can reach into a JSON field.
  return path.split('.').reduce<unknown>(
    (acc, part) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[part] : undefined),
    scope.config,
  );
}

const transform = (value: unknown, name: string | undefined): unknown =>
  name === 'object' ? pairsToObject(value) : value;

/**
 * Resolves one template.
 *
 * Returns the referenced value itself when the template is exactly one
 * reference, and a string otherwise. `undefined` for an unresolved lone
 * reference — NOT the string "undefined", which is the failure this returns a
 * distinct value to avoid.
 */
export function resolveTemplate(template: string, scope: Scope): unknown {
  const whole = template.match(/^\s*\{\{\s*([a-zA-Z0-9_.$]+)\s*(?:\|\s*([a-z]+)\s*)?\}\}\s*$/);
  if (whole) return transform(lookup(whole[1], scope), whole[2]);

  return template.replace(REFERENCE, (_match, path: string, fn: string | undefined) => {
    const value = transform(lookup(path, scope), fn);
    if (isBlank(value)) return '';
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
  });
}

/** First candidate that resolves to something. `undefined` if none do. */
function resolveCandidates(spec: string | string[], scope: Scope): unknown {
  const candidates = Array.isArray(spec) ? spec : [spec];
  for (const candidate of candidates) {
    const value = resolveTemplate(candidate, scope);
    if (!isBlank(value)) return value;
  }
  return undefined;
}

/**
 * Walks a body template, resolving strings and dropping blank entries.
 *
 * Inside a body an array is a JSON array — Resend's `to` is a list of
 * recipients — so the fallback form cannot also be a bare array the way it is
 * for a URL. It is named instead: `{ $first: [...] }` takes the first candidate
 * that resolves. Ambiguity here would have been silent, turning a one-element
 * recipient list into a bare string that Resend rejects.
 */
function resolveBody(value: unknown, scope: Scope): unknown {
  if (typeof value === 'string') return resolveTemplate(value, scope);
  if (Array.isArray(value)) {
    // Blank entries are dropped rather than sent as "", which most APIs read as
    // an invalid recipient rather than an absent one.
    return value.map((v) => resolveBody(v, scope)).filter((v) => !isBlank(v));
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>);
    if (keys.length === 1 && keys[0] === '$first') {
      const candidates = (value as { $first: unknown }).$first;
      return Array.isArray(candidates) ? resolveCandidates(candidates as string[], scope) : undefined;
    }

    // `$when` drops the whole object, not just the empty key. A chat message
    // is `{ role, content }`: without this an unset system prompt leaves
    // `{ role: 'system' }`, which every model API rejects — the object has to
    // disappear entirely or not at all.
    if ('$when' in (value as Record<string, unknown>)) {
      const { $when, ...rest } = value as Record<string, unknown>;
      if (isBlank(resolveBody($when, scope))) return undefined;
      return resolveBody(rest, scope);
    }
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      const resolved = resolveBody(entry, scope);
      // An absent optional field must not become `"replyTo": ""` — several
      // APIs validate the presence of a key rather than its content.
      if (isBlank(resolved)) continue;
      out[key] = resolved;
    }
    return out;
  }
  return value;
}

function applyAuth(auth: NodeAuth | undefined, headers: Record<string, string>, url: URL, scope: Scope): void {
  if (!auth || auth.type === 'none') return;

  switch (auth.type) {
    case 'bearer': {
      const token = lookup(`secret.${auth.secret}`, scope);
      if (!isBlank(token)) headers.Authorization = `Bearer ${token}`;
      break;
    }
    case 'basic': {
      const user = lookup(`secret.${auth.userSecret}`, scope);
      const pass = lookup(`secret.${auth.passSecret}`, scope);
      if (!isBlank(user) && !isBlank(pass)) {
        headers.Authorization = `Basic ${base64(`${user}:${pass}`)}`;
      }
      break;
    }
    case 'header': {
      const value = lookup(`secret.${auth.secret}`, scope);
      if (!isBlank(value)) headers[auth.name] = `${auth.prefix ?? ''}${value}`;
      break;
    }
    case 'query': {
      const value = lookup(`secret.${auth.secret}`, scope);
      if (!isBlank(value)) url.searchParams.set(auth.name, String(value));
      break;
    }
  }
}

/** `btoa` is present in Deno and every browser this runs in; Buffer is not. */
function base64(input: string): string {
  if (typeof btoa === 'function') return btoa(input);
  // deno-lint-ignore no-explicit-any
  return (globalThis as any).Buffer.from(input, 'utf8').toString('base64');
}

const formEncode = (body: Record<string, unknown>): string =>
  Object.entries(body)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(typeof v === 'object' ? JSON.stringify(v) : String(v))}`)
    .join('&');

export interface BuildInput {
  request: NodeRequest;
  /** Step config with every `{{…}}` reference to upstream steps already resolved. */
  config: Record<string, unknown>;
  /** Saved credentials for this step's integration, keyed as the registry names them. */
  secrets: Record<string, string>;
}

/**
 * Builds the request, or explains why it cannot be built.
 *
 * A missing credential is reported rather than sent: a call with a blank
 * Authorization header is a 401 the person has to go and decode, when the
 * actual answer — "Twilio has no auth token saved" — was knowable before
 * leaving the building.
 */
export function buildRequest({ request, config, secrets }: BuildInput): BuildResult {
  const scope: Scope = { config, secrets, usedSecrets: new Set(), missing: new Set() };

  for (const key of request.requires ?? []) {
    if (isBlank(secrets[key])) scope.missing.add(key);
  }

  const rawUrl = resolveCandidates(request.url, scope);
  if (isBlank(rawUrl)) {
    return {
      ok: false,
      failure: {
        missingSecrets: [...scope.missing],
        error: scope.missing.size
          ? `This step needs ${[...scope.missing].join(', ')} on the Integrations page.`
          : 'The endpoint for this step could not be resolved from its settings.',
      },
    };
  }

  let url: URL;
  try {
    url = new URL(String(rawUrl));
  } catch {
    return { ok: false, failure: { missingSecrets: [], error: `“${rawUrl}” is not a valid URL.` } };
  }

  const headers: Record<string, string> = {};
  for (const [key, template] of Object.entries(request.headers ?? {})) {
    const value = resolveTemplate(template, scope);
    if (!isBlank(value)) headers[key] = String(value);
  }

  for (const [key, template] of Object.entries(request.query ?? {})) {
    const value = resolveCandidates(template, scope);
    if (!isBlank(value)) url.searchParams.set(key, String(value));
  }

  applyAuth(request.auth, headers, url, scope);

  let body: string | undefined;
  if (request.body && request.method !== 'GET') {
    const resolvedBody = resolveBody(request.body, scope);
    // A body template that is a single reference yields whatever that
    // reference held — an object for a webhook payload, a string for a raw
    // one. Anything else is already an object.
    const resolved = (typeof resolvedBody === 'object' && resolvedBody !== null
      ? resolvedBody
      : { value: resolvedBody }) as Record<string, unknown>;
    if (request.encoding === 'form') {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      body = formEncode(resolved);
    } else {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(resolved);
    }
  }

  // Reported after everything has been resolved, so one pass names every
  // missing credential rather than making the person fix them one at a time.
  if (scope.missing.size) {
    const names = [...scope.missing];
    return {
      ok: false,
      failure: {
        missingSecrets: names,
        error: `This step needs ${names.join(', ')} saved on the Integrations page before it can run.`,
      },
    };
  }

  return {
    ok: true,
    request: {
      method: request.method,
      url: url.toString(),
      headers,
      body,
      secretValues: [...scope.usedSecrets].map((k) => secrets[k]).filter((v) => typeof v === 'string' && v.length > 3),
    },
  };
}

/** Reads a dotted path out of a response body. */
export function readPath(source: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, part) => {
    if (acc === null || acc === undefined) return undefined;
    if (Array.isArray(acc)) {
      const index = Number(part);
      return Number.isInteger(index) ? acc[index] : undefined;
    }
    if (typeof acc === 'object') return (acc as Record<string, unknown>)[part];
    return undefined;
  }, source);
}

export interface ResponseShape {
  status: number;
  body: unknown;
}

/**
 * Maps a response onto the outputs the catalog declared.
 *
 * The declared outputs are what the token picker offers to downstream steps, so
 * a step whose response does not populate them is a step whose `{{…}}`
 * references silently resolve to nothing. Anything unmapped falls back to the
 * response body's own key of the same name, which covers the common case where
 * a vendor already uses the name the catalog chose.
 */
export function mapOutputs(node: CatalogNode, response: ResponseShape): Record<string, unknown> {
  const mapping = node.request?.outputs ?? {};
  const out: Record<string, unknown> = {};

  for (const declared of node.outputs) {
    const path = mapping[declared.key];
    if (path === '$status') out[declared.key] = response.status;
    else if (path === '$body') out[declared.key] = response.body;
    else if (path) out[declared.key] = readPath(response.body, path);
    else out[declared.key] = readPath(response.body, declared.key);
  }

  // Keep the raw payload reachable for anything the catalog did not model.
  out.$response = response.body;
  return out;
}

/**
 * Whether the vendor is telling us this failed.
 *
 * HTTP status is the first word, not the last: Slack answers 200 with
 * `{"ok": false}`, and a step recorded as succeeded when the message was never
 * posted is worse than one that failed loudly.
 */
export function requestFailure(request: NodeRequest, response: ResponseShape): string | null {
  if (request.okPath) {
    const ok = readPath(response.body, request.okPath);
    if (ok === false) {
      const detail = request.errorPath ? readPath(response.body, request.errorPath) : null;
      return detail ? String(detail) : 'The provider rejected the request.';
    }
  }

  if (request.errorPath) {
    const detail = readPath(response.body, request.errorPath);
    if (detail && typeof detail !== 'object') return String(detail);
    if (detail && typeof detail === 'object') {
      const message = readPath(detail, 'message');
      if (message) return String(message);
    }
  }

  if (response.status < 200 || response.status >= 400) {
    return `The provider answered ${response.status}.`;
  }
  return null;
}
