/**
 * A worded absence must never occupy a value slot.
 *
 * `parse-property-pdf` wrote the literal string "Address Not Found" into the
 * address field whenever nothing was extracted. That string is TRUTHY, so it
 * survived every `||` fallback on the way out — `PropertyImportPanel`'s
 * `details.extractedAddress || details.propertyAddress || details.address`,
 * `documentExtract`'s `str(...)`, and the report's own `property_address` —
 * and arrived on screen as the property's recorded address. The 19 Sep 2026
 * clone audit reported it as exactly that.
 *
 * It is the same rule the reports programme already paid for with
 * `propertyTypeLabel`, whose "Not stated in the record — never write
 * 'Residential Property'" was interpolated into a table cell and quoted back
 * by the model as the property's type: **an instruction must never occupy a
 * value slot.** The slot carries the fact or nothing, and each reader states
 * the absence in its own words.
 *
 * Source-level, because nothing fails when a sentence is returned as a value —
 * it renders.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { processToStructuredPayload } from '@/lib/documentText/propertyExtraction';

const root = join(__dirname, '..', '..', '..', '..');

const FILES = [
  join('supabase', 'functions', '_shared', 'propertyExtraction.pure.ts'),
  join('supabase', 'functions', 'parse-property-pdf', 'index.ts'),
];

/**
 * A sentence in a value slot is one assigned or returned as a value — a
 * mention inside a comment is the record of why this rule exists and must
 * stay readable.
 */
function stripComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

describe('no worded absence in an address value slot', () => {
  it('answers null for an extraction that read no address', () => {
    expect(processToStructuredPayload({}).propertyAddress).toBeNull();
  });

  it('never names the sentinel outside a comment', () => {
    const offenders: string[] = [];
    for (const relative of FILES) {
      const code = stripComments(readFileSync(join(root, relative), 'utf8'));
      if (/Address Not Found/.test(code)) offenders.push(relative);
    }
    expect(offenders).toEqual([]);
  });

  it('keeps the reason on the record', () => {
    // The rule is worth nothing if the next reader puts the sentinel back
    // because the comment explaining it went with the code.
    const pure = readFileSync(join(root, FILES[0]), 'utf8');
    expect(pure).toMatch(/value slot/i);
  });
});
