/**
 * The document people download is the document that was reviewed.
 *
 * ## Why this suite is the important one now
 *
 * The platform used to DRAW these agreements: the locked content modules were
 * rendered into Word in the browser on every download. A renderer can only
 * ever be as correct as its own content, and it made the presentation of a
 * legal instrument a property of this codebase — which is how three different
 * typesettings of the same two agreements came to exist here at once (a Python
 * builder, the browser renderer, and the documents their author actually
 * maintains).
 *
 * Now the author's file is shipped and handed over unchanged. That trades one
 * risk for another: nobody can read a `.docx` in a diff, so a file could be
 * replaced with one missing a clause, carrying somebody's name in its
 * metadata, or simply corrupt, and code review would show a binary blob
 * changing size.
 *
 * So this suite opens the shipped file and checks it. The locked content
 * modules are no longer the renderer — they are the SPECIFICATION, and every
 * subclause, heading, note and responsibility bullet they define must be
 * present, verbatim, in the bytes a partner receives.
 *
 * If you are replacing a document: drop it in, update `byteLength`/`sha256` in
 * `templateFiles.pure.ts`, and run this. What it reports missing is wording
 * the reviewed template had and the new file does not.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import JSZip from 'jszip';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  AGREEMENT_TEMPLATE_FILES,
  AGREEMENT_TEMPLATE_SUMMARIES,
  agreementHeadingCase,
  agreementTemplate,
  agreementTemplateContents,
  agreementTemplateFile,
  agreementTemplateUrl,
  substitutePlain,
  type AgreementTemplateContent,
  type AgreementTemplateKey,
} from '@/lib/agreements';

const KEYS: AgreementTemplateKey[] = ['strategic_property_referral', 'finance_referral_commission'];

const PUBLIC_DIR = join(process.cwd(), 'public', 'templates', 'finance-portal');

const filePath = (key: AgreementTemplateKey) =>
  join(PUBLIC_DIR, agreementTemplateFile(key).fileName);

/**
 * Two documents may spell the same sentence differently and still be the same
 * sentence: a typographic apostrophe for a straight one, an em dash for a
 * hyphen, a line break where the module has a space. None of those is a change
 * to the wording, and treating them as one would make this suite fail for
 * reasons nobody should have to care about.
 *
 * Everything else — every word, every number, every clause reference — is
 * compared exactly.
 */
function normalise(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The module's text as the unfilled template prints it — `<<INSERT>>` and all. */
function asPrinted(text: string, key: AgreementTemplateKey): string {
  return normalise(substitutePlain(text, key, {}));
}

interface OpenDocument {
  /** Every `<w:t>` run in `word/document.xml`, joined and normalised. */
  text: string;
  parts: string[];
  /** The whole package, for scanning metadata as well as body copy. */
  bytes: Buffer;
  documentXml: string;
  relIds: Set<string>;
  usedRelIds: Set<string>;
  definedStyles: Set<string>;
  usedStyles: Set<string>;
  headerText: string;
}

async function openDocument(key: AgreementTemplateKey): Promise<OpenDocument> {
  const bytes = readFileSync(filePath(key));
  const zip = await JSZip.loadAsync(bytes);
  const parts = Object.keys(zip.files).sort();

  const read = async (name: string) => {
    const entry = zip.file(name);
    return entry ? entry.async('string') : '';
  };

  const documentXml = await read('word/document.xml');
  const relsXml = await read('word/_rels/document.xml.rels');
  const stylesXml = await read('word/styles.xml');
  const headerXml = await read('word/header1.xml');

  const runs = (xml: string) =>
    [...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
      .map(([, run]) => run
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&'))
      .join('');

  const matches = (xml: string, pattern: RegExp) =>
    new Set([...xml.matchAll(pattern)].map(([, value]) => value));

  return {
    bytes,
    parts,
    documentXml,
    text: normalise(runs(documentXml)),
    headerText: normalise(runs(headerXml)),
    relIds: matches(relsXml, /Id="([^"]+)"/g),
    usedRelIds: matches(documentXml, /r:(?:id|embed|link)="([^"]+)"/g),
    definedStyles: matches(stylesXml, /w:styleId="([^"]+)"/g),
    usedStyles: new Set([
      ...matches(documentXml, /<w:pStyle w:val="([^"]+)"/g),
      ...matches(documentXml, /<w:rStyle w:val="([^"]+)"/g),
    ]),
  };
}

const documents = new Map<AgreementTemplateKey, OpenDocument>();

beforeAll(async () => {
  for (const key of KEYS) documents.set(key, await openDocument(key));
});

const doc = (key: AgreementTemplateKey) => documents.get(key)!;

describe('the manifest describes the file that is actually there', () => {
  it('covers every template, once', () => {
    expect(AGREEMENT_TEMPLATE_FILES.map((file) => file.key).sort()).toEqual([...KEYS].sort());
    expect(AGREEMENT_TEMPLATE_SUMMARIES.map((summary) => summary.key).sort()).toEqual([...KEYS].sort());
  });

  it.each(KEYS)('%s: the file is exactly the one the manifest names', (key) => {
    const declared = agreementTemplateFile(key);
    const bytes = doc(key).bytes;
    expect(bytes.byteLength).toBe(declared.byteLength);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(declared.sha256);
  });

  it.each(KEYS)('%s: both portals fetch the same path', (key) => {
    // One directory, one file, one set of bytes for either side. The moment
    // the two portals can resolve different documents, "the same neutral
    // resource on the same terms" stops being true.
    expect(agreementTemplateUrl(key))
      .toBe(`/templates/finance-portal/${agreementTemplateFile(key).fileName}`);
  });

  it.each(KEYS)('%s: the manifest version matches the document and the module', (key) => {
    const declared = agreementTemplateFile(key);
    expect(agreementTemplate(key).documentVersion).toBe(declared.documentVersion);
    // The running header is what a reader sees on every page after the cover.
    expect(doc(key).headerText).toContain(`Version ${declared.documentVersion}`);
  });
});

describe('the shipped package is a document Word will open', () => {
  it.each(KEYS)('%s: carries the parts a .docx needs', (key) => {
    // A missing part is not a subtle defect — it is a file that opens as
    // "unreadable content" on the recipient's machine, with nothing on our
    // side having complained.
    for (const part of [
      '[Content_Types].xml',
      '_rels/.rels',
      'word/document.xml',
      'word/_rels/document.xml.rels',
      'word/styles.xml',
    ]) {
      expect(doc(key).parts).toContain(part);
    }
  });

  it.each(KEYS)('%s: references nothing it does not contain', (key) => {
    const { usedRelIds, relIds, usedStyles, definedStyles } = doc(key);
    expect([...usedRelIds].filter((id) => !relIds.has(id))).toEqual([]);
    expect([...usedStyles].filter((id) => !definedStyles.has(id))).toEqual([]);
    // Numbered lists without a numbering part render unnumbered, which in a
    // document whose clauses are its structure is a real loss.
    if (doc(key).documentXml.includes('<w:numPr')) {
      expect(doc(key).parts).toContain('word/numbering.xml');
    }
  });

  it.each(KEYS)('%s: has one section, with its header and footer attached', (key) => {
    const xml = doc(key).documentXml;
    expect((xml.match(/<w:sectPr/g) ?? []).length).toBe(1);
    expect(xml).toMatch(/<w:headerReference[^>]*r:id="[^"]+"/);
    expect(xml).toMatch(/<w:footerReference[^>]*r:id="[^"]+"/);
  });
});

describe('the shipped document carries the reviewed wording', () => {
  /**
   * Walks the locked content module and returns every piece of legal text it
   * defines, labelled so a failure names the clause rather than the offset.
   *
   * Grids are deliberately NOT included: their labels are the completion
   * fields, they differ only in case between the module and the document, and
   * asserting on them would make this suite fail for typography. Clauses,
   * headings, notes, responsibility bullets and the consent declaration are
   * the content that decides what the parties agreed.
   */
  function reviewedText(content: AgreementTemplateContent): { label: string; text: string }[] {
    const out: { label: string; text: string }[] = [];
    for (const section of content.sections) {
      for (const block of section.blocks) {
        if (block.kind === 'clauses') {
          for (const clause of block.clauses) {
            for (const sub of clause.subclauses) {
              out.push({ label: `clause ${sub.number}`, text: sub.text });
            }
          }
        } else if (block.kind === 'note') {
          out.push({ label: `note "${block.label}"`, text: block.body });
        } else if (block.kind === 'dualPanel') {
          for (const side of [block.left, block.right]) {
            for (const bullet of side.bullets) {
              out.push({ label: `${side.title} bullet`, text: bullet });
            }
          }
        } else if (block.kind === 'consent') {
          out.push({ label: `consent "${block.label}"`, text: block.body });
        }
      }
    }
    return out;
  }

  it.each(KEYS)('%s: every clause, note and bullet is present verbatim', (key) => {
    const body = doc(key).text;
    const missing = reviewedText(agreementTemplate(key))
      .filter((entry) => !body.includes(asPrinted(entry.text, key)))
      .map((entry) => `${entry.label}: ${entry.text.slice(0, 80)}`);
    expect(missing).toEqual([]);
  });

  it.each(KEYS)('%s: is not checked against an empty document', (key) => {
    // Guards the guard. If `word/document.xml` were unreadable the loop above
    // would have nothing to search and would still pass on a template with no
    // clauses at all.
    const body = doc(key).text;
    // The shorter of the two runs to ~13,900 characters of body copy.
    expect(body.length).toBeGreaterThan(10_000);
    expect(reviewedText(agreementTemplate(key)).length).toBeGreaterThan(40);
  });

  it.each(KEYS)('%s: every clause heading is present', (key) => {
    const body = doc(key).text.toLowerCase();
    const missing: string[] = [];
    for (const section of agreementTemplate(key).sections) {
      for (const block of section.blocks) {
        if (block.kind !== 'clauses') continue;
        for (const clause of block.clauses) {
          if (!body.includes(normalise(clause.heading).toLowerCase())) missing.push(clause.heading);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it.each(KEYS)('%s: still says it is a template requiring review', (key) => {
    // The one line on the cover that stops it reading as an executed
    // instrument. If a replacement document loses it, this fails loudly.
    expect(doc(key).text.toLowerCase())
      .toContain('template only - obtain legal, licensing, privacy and aggregator approval before use.');
  });
});

describe('the desk describes the document it hands over', () => {
  it.each(KEYS)('%s: every listed section is a section the file contains', (key) => {
    const body = doc(key).text.toLowerCase();
    const missing = agreementTemplateContents(key)
      .filter((entry) => !body.includes(normalise(entry.heading).toLowerCase()))
      .map((entry) => `${entry.badge} ${entry.heading}`);
    expect(missing).toEqual([]);
  });

  it.each(KEYS)('%s: lists the sections in document order, with the cover left out', (key) => {
    const entries = agreementTemplateContents(key);
    const headed = agreementTemplate(key).sections.filter((section) => section.header);
    expect(entries.map((entry) => entry.badge)).toEqual(headed.map((section) => section.header!.badge));
    expect(entries.length).toBeGreaterThan(8);
  });

  it.each(KEYS)('%s: marks the pages the template says to remove before issue', (key) => {
    // "…and delete this guidance card before issue" is the document's own
    // instruction. A reader who misses it sends the partner our notes.
    expect(agreementTemplateContents(key).some((entry) => entry.guidance)).toBe(true);
  });

  it('sets headings in sentence case without mangling an initialism', () => {
    expect(agreementHeadingCase('COMMERCIAL SCHEDULE')).toBe('Commercial schedule');
    expect(agreementHeadingCase('GST AND RCTIS')).toBe('GST and RCTIs');
    expect(agreementHeadingCase('CLIENT CONSENT, PRIVACY & COMMUNICATIONS'))
      .toBe('Client consent, privacy & communications');
  });

  it.each(KEYS)('%s: no heading comes out shouting or empty', (key) => {
    for (const entry of agreementTemplateContents(key)) {
      expect(entry.heading.length).toBeGreaterThan(2);
      // An all-caps heading here means `agreementHeadingCase` was bypassed.
      expect(entry.heading).not.toBe(entry.heading.toUpperCase());
    }
  });
});

describe('the document names no tenant', () => {
  /**
   * This product is sold to other agencies, and the pack is white-label. The
   * failure mode is quiet: a document that is wrong in one line and right in
   * every other does not look wrong.
   *
   * Scanned over the WHOLE package, not just the body — `docProps/core.xml`
   * and `app.xml` carry the author and company Word stamped on the file, and
   * a partner opening it in Word sees them in File → Info.
   */
  const TENANT_IDENTITY = [
    'Naidu', 'NPC Services', 'NPC Property', 'npcservices',
    '50 684 555 771', '8609 3299', 'admin@npcservices',
  ];

  it.each(KEYS)('%s: carries no tenant identity anywhere in the package', (key) => {
    const blob = doc(key).bytes.toString('latin1');
    for (const needle of TENANT_IDENTITY) {
      expect(blob).not.toContain(needle);
    }
  });

  it.each(KEYS)('%s: leaves the company name to whoever fills it in', (key) => {
    // The cover is built around this placeholder. Its presence is what makes
    // the document neutral for either side to use.
    expect(doc(key).text).toContain('<<COMPANY NAME>>');
  });
});
