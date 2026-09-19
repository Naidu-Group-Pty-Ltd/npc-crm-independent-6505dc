/**
 * Every error code the union declares has a sentence and a remedy.
 *
 * `registry_empty`, `sources_disabled` and `ingestion_empty` were declared in
 * `MarketUpdatesErrorCode` and produced by nothing, with no entry in either
 * map — so the 422 that should have been one of them fell to `unknown` and the
 * operator read "Market News Feed could not complete this operation." over an
 * unseeded registry. A code with no words is a code that cannot be shown.
 *
 * Source-level, because an unmapped code costs nothing at compile time: both
 * maps are `Record<string, string>` and a miss is `undefined`, which the
 * `?? messages.unknown` beside them absorbs silently.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { MARKET_ERROR_CODES } from '../operationalIssue.pure';

const root = join(__dirname, '..', '..', '..', '..');
const types = readFileSync(join(root, 'src', 'types', 'marketUpdates.ts'), 'utf8');
const service = readFileSync(join(root, 'src', 'services', 'marketUpdatesService.ts'), 'utf8');

/** The union, read from the type rather than restated. */
function declaredCodes(): string[] {
  const match = /export type MarketUpdatesErrorCode = ([^;]+);/.exec(types);
  expect(match, 'MarketUpdatesErrorCode could not be read').toBeTruthy();
  return [...match![1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

/** The keys of one object literal in the service, read from it. */
function mapKeys(name: string): string[] {
  const match = new RegExp(
    `const ${name}: Record<string, string> = \\{([\\s\\S]*?)\\n  \\};`,
  ).exec(service);
  expect(match, `${name} could not be read from the service`).toBeTruthy();
  return [...match![1].matchAll(/(?:^|[\s{,])([a-z_]+)\s*:/gm)].map((m) => m[1]);
}

describe('market updates error codes', () => {
  const declared = declaredCodes();

  it('reads the union rather than restating it', () => {
    expect(declared.length).toBeGreaterThan(20);
    expect(declared).toContain('registry_empty');
  });

  it('gives every declared code a sentence', () => {
    const messages = new Set(mapKeys('messages'));
    expect(declared.filter((code) => !messages.has(code))).toEqual([]);
  });

  it('gives every declared code a remedy', () => {
    const remediation = new Set(mapKeys('remediation'));
    expect(declared.filter((code) => !remediation.has(code))).toEqual([]);
  });

  it('keeps the classifier recognising exactly the union', () => {
    // Two lists of the same codes is how one of them goes stale.
    expect([...MARKET_ERROR_CODES].sort()).toEqual([...declared].sort());
  });
});
