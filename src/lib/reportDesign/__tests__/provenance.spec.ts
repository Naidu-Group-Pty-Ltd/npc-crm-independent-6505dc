/**
 * The row a delivered PDF came from, carried inside the PDF.
 *
 * `weasyprintClient.ts` is a Deno module with no bridge under `src/`, so this
 * imports the canonical file directly — the same thing `engineSupport.spec.ts`
 * does two describes down when it reads the client as text. Vitest resolves the
 * `.ts` path fine; nothing in that module imports anything.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { withProvenance } from '../../../../supabase/functions/_shared/weasyprintClient';

const REPO = resolve(__dirname, '../../../..');
const HEAD = '<!DOCTYPE html>\n<html lang="en-AU">\n<head>\n<meta charset="utf-8">\n'
  + '<title>Report</title>\n</head>\n<body><h1>x</h1></body>\n</html>';

describe('what a report says about where it came from', () => {
  it('stamps the format, the ledger row and the source row', () => {
    const html = withProvenance(HEAD, {
      format: 'borrowing-capacity',
      renderId: 'b7c1a0e2-0000-4000-8000-000000000001',
      sourceId: 'a1b2c3d4-0000-4000-8000-000000000002',
      renderedAt: '2026-08-05T04:00:00.000Z',
    });
    expect(html).toContain('<meta name="npc-format" content="borrowing-capacity">');
    expect(html).toContain('<meta name="npc-render-id" content="b7c1a0e2-0000-4000-8000-000000000001">');
    expect(html).toContain('<meta name="npc-source-id" content="a1b2c3d4-0000-4000-8000-000000000002">');
    expect(html).toContain('<meta name="npc-rendered-at" content="2026-08-05T04:00:00.000Z">');
  });

  it('leaves a document alone when there is nothing to say', () => {
    expect(withProvenance(HEAD, undefined)).toBe(HEAD);
  });

  it('omits a field rather than stamping an empty one', () => {
    // A `/npcrenderid ()` in the Info dictionary is worse than no key: it looks
    // like a render that failed to record itself rather than one that was never
    // asked to.
    const html = withProvenance(HEAD, { format: 'converted', renderId: null });
    expect(html).toContain('npc-format');
    expect(html).not.toContain('npc-render-id');
    expect(html).not.toContain('npc-rendered-at');
  });

  it('goes inside the head, before anything the document already declares', () => {
    const html = withProvenance(HEAD, { format: 'report-qa' });
    expect(html.indexOf('npc-format')).toBeGreaterThan(html.indexOf('<head>'));
    expect(html.indexOf('npc-format')).toBeLessThan(html.indexOf('<title>'));
  });

  it('returns a document with no head unchanged', () => {
    // A missing stamp is not worth failing a render over, and the alternative —
    // prepending a head to a fragment — would produce a document the engine
    // parses differently from the one the caller built.
    const fragment = '<div>no head here</div>';
    expect(withProvenance(fragment, { format: 'cash-flow-projection' })).toBe(fragment);
  });

  it('cannot escape the attribute it is written into', () => {
    const html = withProvenance(HEAD, {
      format: 'x',
      renderId: '"><script>alert(1)</script>',
      sourceId: 'a & b',
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&quot;&gt;&lt;script&gt;');
    expect(html).toContain('content="a &amp; b"');
  });

  it('strips control characters, which would break the head', () => {
    const html = withProvenance(HEAD, { format: 'x', renderId: 'a\n<meta name="b" content="c">' });
    expect(html).not.toMatch(/name="b"/);
  });
});

describe('the switch that carries the stamp into the file', () => {
  /**
   * Measured against the pinned engine rather than read from a document:
   * `custom_metadata` copies each `<meta name=…>` into the PDF's document
   * information dictionary, lowercasing the key and stripping everything that
   * is not a letter or a digit — so `npc-render-id` arrives as `/npcrenderid`.
   * A `pdf/ua-1` file carrying all four validates clean, 106 rules passed.
   */
  it('is asked for by the client and honoured by the service', () => {
    const client = readFileSync(
      resolve(REPO, 'supabase/functions/_shared/weasyprintClient.ts'),
      'utf8',
    );
    const app = readFileSync(resolve(REPO, 'weasyprint-service/app.py'), 'utf8');
    expect(client).toContain('custom_metadata: true');
    expect(app).toMatch(/"custom_metadata": custom_metadata/);
  });

  it('is sent through the same body the html is', () => {
    // The tags are injected into the document, not passed as a side channel —
    // the engine reads them out of the HTML and nowhere else.
    const client = readFileSync(
      resolve(REPO, 'supabase/functions/_shared/weasyprintClient.ts'),
      'utf8',
    );
    expect(client).toContain('const stamped = withProvenance(html, options.provenance);');
    expect(client).toContain('html: stamped,');
  });
});
