/**
 * The converter's two routes, as contracts.
 *
 * The edge functions themselves do auth, a model call, a WeasyPrint render, an
 * upload and four writes — none of which a unit test can reach. What *is*
 * reachable is everything they decide before any of that: what a caller may
 * send, where the file lands, what the model is asked for, and what the reader
 * refuses.
 *
 * Each assertion below is here because breaking the thing it guards produces a
 * failure that is either silent or expensive:
 *
 * - a format the converter cannot bind to renders a document with no chapters
 *   and no explanation;
 * - a source suffix nobody checked reaches a model as base64 of a `.docx`;
 * - the *public* `report-templates` bucket puts somebody's uploaded template
 *   behind a guessable URL;
 * - an extraction prompt that stops insisting on ATX headings produces
 *   beautiful prose and a one-section document every time.
 */
/* eslint-disable no-restricted-syntax --
 * Fixture brand colours. A design system's accent is document data, and these
 * are the values a request carries — not palette choices in a component.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  base64Bytes,
  convertedFileName,
  convertedReference,
  convertedStoragePath,
  DEFAULT_LIST_LIMIT,
  MAX_LIST_LIMIT,
  MAX_SOURCE_BYTES,
  parseConvertRequest,
  pdfExtractionPrompt,
  readDesignSystemRow,
  sourceKindFor,
  STORAGE_BUCKET,
  TEXT_SUFFIXES,
} from '../route.pure';
import { bindableFormats, proposeBinding } from '../binding.pure';
import { extractStructure } from '../structure.pure';
import { planConvertedChapters, renderConvertedDocument } from '../render.pure';
import { extractJsonObject, MIN_BRIEF_CHARS, parseBrandRequest } from '../../../brandDesign/route.pure';
import { MAX_IMPORT_CHARS } from '../../../brandDesign/import.pure';
import { REPORT_ARCHETYPES } from '../../../reportDesign/structure.pure';
import {
  auditPaletteContrast,
  resolveReportPalette,
} from '../../../../../supabase/functions/_shared/reportDesign/brandResolve.pure';
import { DEFAULT_REPORT_DESIGN_OPTIONS } from '../../../../../supabase/functions/_shared/reportDesign/options.pure';
import { resolveCompanyBlock } from '../../../../../supabase/functions/_shared/reportDesign/companyBlock.pure';

const FORMAT = bindableFormats()[0];
const UUID = '4b1d9e3a-6c2f-4a8b-9d1e-2f3a4b5c6d7e';

/** A base64 payload of a given decoded size, without actually allocating a file. */
const base64OfBytes = (bytes: number) => 'A'.repeat(Math.ceil(bytes / 3) * 4);

describe('parseConvertRequest', () => {
  it('refuses a format the converter has no chapters for', () => {
    // `bindableFormats()` is the list; an archetype outside it has no entry in
    // `FORMAT_CHAPTERS`, so binding to it produces a spine with zero chapters.
    const parsed = parseConvertRequest({ action: 'extract', format: 'investment-compass' });
    expect(parsed.ok).toBe(false);
    if (parsed.ok === false) expect(parsed.error).toContain(FORMAT);
  });

  it('refuses a source whose suffix it cannot read', () => {
    const parsed = parseConvertRequest({
      action: 'extract',
      format: FORMAT,
      fileName: 'Template.docx',
      sourceBase64: 'QQ==',
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok === false) expect(parsed.error).toContain('Template.docx');
  });

  it('accepts every text suffix it advertises, and pdf', () => {
    for (const suffix of [...TEXT_SUFFIXES, '.pdf']) {
      const parsed = parseConvertRequest({
        action: 'extract',
        format: FORMAT,
        fileName: `Template${suffix}`,
        sourceBase64: 'QQ==',
      });
      expect(parsed.ok, suffix).toBe(true);
      if (parsed.ok && parsed.request.action === 'extract') {
        expect(parsed.request.kind).toBe(suffix === '.pdf' ? 'pdf' : 'text');
      }
    }
  });

  it('refuses an upload over the ceiling, and accepts one just under it', () => {
    const over = parseConvertRequest({
      action: 'extract',
      format: FORMAT,
      fileName: 'Template.pdf',
      sourceBase64: base64OfBytes(MAX_SOURCE_BYTES + 4_096),
    });
    expect(over.ok).toBe(false);

    const under = parseConvertRequest({
      action: 'extract',
      format: FORMAT,
      fileName: 'Template.pdf',
      sourceBase64: base64OfBytes(MAX_SOURCE_BYTES - 4_096),
    });
    expect(under.ok).toBe(true);
  });

  it('refuses an empty upload rather than sending nothing to a model', () => {
    const parsed = parseConvertRequest({
      action: 'extract',
      format: FORMAT,
      fileName: 'Template.pdf',
      sourceBase64: '',
    });
    expect(parsed.ok).toBe(false);
  });

  it('requires a uuid for propose and render', () => {
    for (const action of ['propose', 'render']) {
      const parsed = parseConvertRequest({ action, format: FORMAT, conversionId: 'not-a-uuid' });
      expect(parsed.ok, action).toBe(false);
    }
  });

  it('refuses a malformed designSystemId rather than silently rendering the house design', () => {
    // Silently falling back would set somebody's draft in a design they did not
    // choose, with nothing on the page to say so.
    const parsed = parseConvertRequest({
      action: 'render',
      format: FORMAT,
      conversionId: UUID,
      designSystemId: 'nope',
    });
    expect(parsed.ok).toBe(false);
  });

  it('treats an absent designSystemId as the house design', () => {
    const parsed = parseConvertRequest({ action: 'render', format: FORMAT, conversionId: UUID });
    expect(parsed.ok).toBe(true);
    if (parsed.ok && parsed.request.action === 'render') {
      expect(parsed.request.designSystemId).toBeNull();
    }
  });

  it('names the actions it knows when given one it does not', () => {
    const parsed = parseConvertRequest({ action: 'convert', format: FORMAT });
    expect(parsed.ok).toBe(false);
    if (parsed.ok === false) {
      expect(parsed.error).toContain('extract');
      expect(parsed.error).toContain('propose');
      expect(parsed.error).toContain('render');
      expect(parsed.error).toContain('list');
      expect(parsed.error).toContain('chapters');
    }
  });
});

describe('the actions that name no format', () => {
  // The regression guard for an ordering decision that is easy to undo by
  // accident. `parseConvertRequest` validates `format` for every other action
  // *before* it looks at which action was asked for, so `list` and `chapters`
  // have to be handled above that check. Move either branch below it and the
  // request is refused with an error about report formats, which has nothing to
  // do with what was asked — and the history panel silently shows nothing.
  it('accepts a listing with no format at all', () => {
    const parsed = parseConvertRequest({ action: 'list' });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.request.action).toBe('list');
  });

  it('accepts a chapters request with no format, given a uuid', () => {
    const parsed = parseConvertRequest({ action: 'chapters', conversionId: UUID });
    expect(parsed.ok).toBe(true);
    if (parsed.ok && parsed.request.action === 'chapters') {
      expect(parsed.request.conversionId).toBe(UUID);
    }
  });

  it('still requires a uuid for chapters', () => {
    expect(parseConvertRequest({ action: 'chapters', conversionId: 'nope' }).ok).toBe(false);
  });

  it('clamps the listing limit and defaults it', () => {
    const def = parseConvertRequest({ action: 'list' });
    expect(def.ok && def.request.action === 'list' && def.request.limit).toBe(DEFAULT_LIST_LIMIT);

    const huge = parseConvertRequest({ action: 'list', limit: 5_000 });
    expect(huge.ok && huge.request.action === 'list' && huge.request.limit).toBe(MAX_LIST_LIMIT);

    const zero = parseConvertRequest({ action: 'list', limit: 0 });
    expect(zero.ok && zero.request.action === 'list' && zero.request.limit).toBe(1);

    const junk = parseConvertRequest({ action: 'list', limit: 'ten' });
    expect(junk.ok && junk.request.action === 'list' && junk.request.limit).toBe(DEFAULT_LIST_LIMIT);
  });
});

describe('base64Bytes', () => {
  it('accounts for padding', () => {
    // `btoa('a')` is 'YQ==' — one byte, four characters. Ignoring the padding
    // over-counts by two on every short payload and, more to the point, makes
    // the size ceiling wrong by a byte or two at the boundary.
    expect(base64Bytes('YQ==')).toBe(1);
    expect(base64Bytes('YWI=')).toBe(2);
    expect(base64Bytes('YWJj')).toBe(3);
    expect(base64Bytes('')).toBe(0);
  });
});

describe('sourceKindFor', () => {
  it('guesses nothing', () => {
    expect(sourceKindFor('Template.docx')).toBeNull();
    expect(sourceKindFor('Template')).toBeNull();
    expect(sourceKindFor('Template.PDF')).toBe('pdf');
    expect(sourceKindFor('Template.MD')).toBe('text');
  });
});

describe('where the file lands', () => {
  it('is not the public report-templates bucket', () => {
    // `report-templates` is public, and its public-ness is load-bearing — asset
    // URLs from it are embedded in saved template JSON. A converted draft
    // carries whatever prose was in somebody's uploaded template.
    expect(STORAGE_BUCKET).not.toBe('report-templates');
    expect(STORAGE_BUCKET).toBe('converted-templates');
  });

  it('puts the conversion id in the path, so a re-render replaces its own file', () => {
    const path = convertedStoragePath(UUID, 'X.pdf');
    expect(path).toContain(UUID);
    expect(convertedStoragePath(UUID, 'X.pdf')).toBe(path);
  });

  it('sanitises a filename built from a template title', () => {
    const name = convertedFileName('Borrowing Power: 2026/27 Edition', FORMAT);
    expect(name).toMatch(/^[A-Za-z0-9_]+\.pdf$/);
    expect(name).not.toContain('/');
    expect(name).toContain('converted');
  });

  it('still produces a filename for an untitled template', () => {
    expect(convertedFileName('', FORMAT)).toMatch(/^Template_converted_/);
    expect(convertedFileName('!!!', FORMAT)).toMatch(/^Template_converted_/);
  });

  it('takes the reference off the front of the id', () => {
    expect(convertedReference(UUID)).toBe('4B1D9E3A');
  });
});

describe('the PDF extraction prompt', () => {
  const prompt = pdfExtractionPrompt('Borrowing Power.pdf');

  it('insists on ATX headings, which are the only thing extraction reads', () => {
    expect(prompt).toContain('ATX');
    expect(prompt).toMatch(/###?/);
    expect(prompt.toLowerCase()).toContain('heading');
  });

  it('forbids rewriting the words', () => {
    // A converter that quietly improves somebody's template is not a converter.
    expect(prompt).toContain('Do not summarise');
    expect(prompt.toLowerCase()).toContain('placeholder');
  });

  it('names the file, so a model has the document title if the page does not', () => {
    expect(prompt).toContain('Borrowing Power.pdf');
  });

  it('tells the model an eyebrow label is not a heading', () => {
    // The failure this rule exists for: reading a page, a model maps type size
    // to heading level, so `SECTION 01` set small above a large chapter title
    // comes back as that title's *parent*. Every chapter of a real Snapshot
    // arrived inverted this way. `extractStructure` folds them anyway, but the
    // repair should not be the only thing standing between us and it.
    expect(prompt).toContain('SECTION 01');
    expect(prompt).toContain('not by type size');
    expect(prompt.toLowerCase()).toContain('siblings');
  });

  it('tells the model the cover is front matter, not sections', () => {
    // A masthead and a client name set large on page one came back as two `#`
    // headings owning nothing, which then defined the shallowest level.
    expect(prompt.toLowerCase()).toContain('front matter');
  });
});

describe('parseBrandRequest', () => {
  const SYSTEM = { name: 'Warm Editorial', brandHex: '#2F5D50', options: { preset: 'signature' } };

  it('refuses a brief too short to design from', () => {
    const parsed = parseBrandRequest({ action: 'generate', brief: 'nice' });
    expect(parsed.ok).toBe(false);
    if (parsed.ok === false) expect(parsed.error).toContain(String(MIN_BRIEF_CHARS));
  });

  it('accepts a real brief', () => {
    const parsed = parseBrandRequest({
      action: 'generate',
      brief: 'A boutique buyers agency writing for first-time investors.',
      companyName: 'Harbour & Vale',
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok && parsed.request.action === 'generate') {
      expect(parsed.request.companyName).toBe('Harbour & Vale');
    }
  });

  it('refuses a malformed brand colour rather than defaulting it', () => {
    // Falling back to the house brand would hand somebody a document in the
    // wrong colour with no indication of why.
    const parsed = parseBrandRequest({ action: 'save', system: { ...SYSTEM, brandHex: 'forest' } });
    expect(parsed.ok).toBe(false);
    if (parsed.ok === false) expect(parsed.error).toContain('brandHex');
  });

  it('refuses a system with no name', () => {
    const parsed = parseBrandRequest({ action: 'audit', system: { ...SYSTEM, name: 'X' } });
    expect(parsed.ok).toBe(false);
  });

  it('refuses a non-uuid id on save', () => {
    const parsed = parseBrandRequest({ action: 'save', system: SYSTEM, id: '17' });
    expect(parsed.ok).toBe(false);
  });

  it('defaults isActive to true and id to null', () => {
    const parsed = parseBrandRequest({ action: 'save', system: SYSTEM });
    expect(parsed.ok).toBe(true);
    if (parsed.ok && parsed.request.action === 'save') {
      expect(parsed.request.isActive).toBe(true);
      expect(parsed.request.id).toBeNull();
    }
  });

  it('accepts a listing with no system in the body', () => {
    // `audit` and `save` both run `readBrandDesignSystem(b.system)`, so the
    // `list` branch has to come first or a listing is refused for not being a
    // design system.
    const parsed = parseBrandRequest({ action: 'list' });
    expect(parsed.ok).toBe(true);
    if (parsed.ok && parsed.request.action === 'list') {
      expect(parsed.request.includeInactive).toBe(false);
    }
  });

  it('carries includeInactive when asked', () => {
    const parsed = parseBrandRequest({ action: 'list', includeInactive: true });
    expect(parsed.ok && parsed.request.action === 'list' && parsed.request.includeInactive).toBe(true);
  });

  it('names the actions it knows', () => {
    const parsed = parseBrandRequest({ action: 'draft' });
    expect(parsed.ok).toBe(false);
    if (parsed.ok === false) {
      expect(parsed.error).toContain('audit');
      expect(parsed.error).toContain('generate');
      expect(parsed.error).toContain('save');
      expect(parsed.error).toContain('list');
    }
  });
});

describe('parseBrandRequest — import', () => {
  it('accepts a file with no design system in the body', () => {
    // Parsed above `audit`/`save` for the same reason `list` is: those two run
    // `readBrandDesignSystem(b.system)` and would refuse an import for carrying
    // a file rather than a system.
    const parsed = parseBrandRequest({ action: 'import', source: ':root { --brand: #D9A520; }' });
    expect(parsed.ok).toBe(true);
    if (parsed.ok && parsed.request.action === 'import') {
      expect(parsed.request.source).toContain('--brand');
      expect(parsed.request.name).toBe('');
    }
  });

  it('refuses an empty file rather than deriving a palette from nothing', () => {
    for (const source of ['', '   ', undefined, 42]) {
      expect(parseBrandRequest({ action: 'import', source }).ok, String(source)).toBe(false);
    }
  });

  it('refuses a file too large to be a design system, saying how large', () => {
    const parsed = parseBrandRequest({ action: 'import', source: 'x'.repeat(MAX_IMPORT_CHARS + 1) });
    expect(parsed.ok).toBe(false);
    if (parsed.ok === false) expect(parsed.error).toContain('KB');
  });

  it('carries a name when one is given, and trims it', () => {
    const parsed = parseBrandRequest({
      action: 'import', source: ':root{--brand:#D9A520}', name: '  Harbour Editorial  ',
    });
    if (parsed.ok && parsed.request.action === 'import') {
      expect(parsed.request.name).toBe('Harbour Editorial');
    }
  });

  it('names import among the actions it knows', () => {
    const parsed = parseBrandRequest({ action: 'nonsense' });
    expect(parsed.ok).toBe(false);
    if (parsed.ok === false) expect(parsed.error).toContain('import');
  });
});

describe('extractJsonObject', () => {
  it('finds an object behind a sentence of preamble', () => {
    expect(extractJsonObject('Here you go:\n{"name":"Warm"}')).toEqual({ name: 'Warm' });
  });

  it('finds one inside a code fence', () => {
    expect(extractJsonObject('```json\n{"name":"Warm"}\n```')).toEqual({ name: 'Warm' });
  });

  it('does not stop at a brace inside a string', () => {
    // A lazy `\{.*\}` cuts this object in half and the reader sees nothing.
    const parsed = extractJsonObject('{"description":"a } brace","name":"Warm"}');
    expect(parsed).toEqual({ description: 'a } brace', name: 'Warm' });
  });

  it('survives an escaped quote before a brace', () => {
    const parsed = extractJsonObject('{"description":"say \\"} \\" then stop","name":"W"}');
    expect((parsed as { name: string }).name).toBe('W');
  });

  it('returns null rather than throwing on an unbalanced object', () => {
    expect(extractJsonObject('{"name":"Warm"')).toBeNull();
    expect(extractJsonObject('no json at all')).toBeNull();
    expect(extractJsonObject('')).toBeNull();
  });
});

describe('the document follows the format it is bound to', () => {
  const structure = extractStructure([
    '# Borrowing Power Assessment',
    `## Client Position Summary\n\n${'Capacity is assessed against a servicing buffer above the advertised rate. '.repeat(4)}`,
    `## Household Income\n\n${'Household income is taken from the payslips supplied at application. '.repeat(4)}`,
    `## Fee Schedule\n\n${'Fees are charged on settlement and are disclosed in the agreement. '.repeat(4)}`,
  ].join('\n\n'), 'Borrowing Power');
  const plan = proposeBinding(FORMAT, structure);
  const rendered = renderConvertedDocument({
    structure,
    plan,
    palette: resolveReportPalette({ preset: 'signature', brandHex: '#2F5D50' }),
    company: resolveCompanyBlock({ company_name: 'Harbour & Vale Advisory' } as never, null),
    masthead: 'Harbour & Vale',
    systemName: 'Warm Editorial',
    preparedOn: '2026-08-04T00:00:00.000Z',
  });

  it('prints a contents page only when the archetype declares one', () => {
    // Measured, not assumed: Borrowing Capacity declares `contents: false`
    // because a short format does not carry one. The renderer used to print one
    // regardless, which broke the binding's promise — a draft bound to a format
    // should open *as* that format — and under-claimed the page budget by
    // exactly one, because the spine costed a page the document was not
    // printing.
    const declaresContents = REPORT_ARCHETYPES[FORMAT].contents;
    const spineHasContents = rendered.spine.some((e) => e.slot === 'contents');
    expect(spineHasContents).toBe(declaresContents);
    expect(rendered.html.includes('>Contents<')).toBe(declaresContents);
  });

  it('claims exactly the pages its own parts add up to', () => {
    // The budget is the spine's sum. If the document renders a block the spine
    // does not carry, the two disagree and every render is short by that block.
    const parts = planConvertedChapters(structure, plan).reduce((n, c) => n + c.pages, 0);
    const furniture = rendered.spine.filter((e) => e.slot !== 'chapter' && e.slot !== 'wide-table')
      .reduce((n, e) => n + e.pageBudget, 0);
    expect(rendered.pageBudget).toBe(parts + furniture);
  });
});

describe('source of truth', () => {
  const bridge = (rel: string) =>
    readFileSync(resolve(__dirname, '..', '..', '..', rel), 'utf8');

  it('keeps the route contracts as one-line bridges to the Edge Function modules', () => {
    // Two copies of "what a request is" is how a client and a server stop
    // agreeing about it. The design-pass modules are on the list for a stronger
    // reason: `enrich.pure.ts` holds the block vocabulary, `renderBlocks` maps
    // it to primitives and `faithfulness` checks the output — a browser copy of
    // any of the three would let the screen describe a document the renderer is
    // not producing.
    for (const rel of [
      'reports/converted/route.pure.ts',
      'reports/converted/enrich.pure.ts',
      'reports/converted/renderBlocks.pure.ts',
      'reports/converted/faithfulness.pure.ts',
      'brandDesign/route.pure.ts',
      // `system.pure.ts` was missing from this list, which is how it could have
      // acquired a browser-side copy of "what a legal design system is".
      // `import.pure.ts` holds the derivation the whole import feature rests
      // on, and a second copy of that would be worse still.
      'brandDesign/system.pure.ts',
      'brandDesign/import.pure.ts',
    ]) {
      const source = bridge(rel);
      const code = source.split('\n').filter((l) => l.trim() && !l.trim().startsWith('*')
        && !l.trim().startsWith('/*') && !l.trim().startsWith('//'));
      expect(code, rel).toHaveLength(1);
      expect(code[0], rel).toMatch(/^export \* from '.*supabase\/functions\/_shared\/.*'/);
    }
  });

  it('keeps the client helpers free of PDF libraries', () => {
    // The whole point of the server render is that no PDF is built in a
    // browser. A jsPDF import here would be a second renderer nobody chose.
    for (const rel of ['reports/converted/requestTemplateConversion.ts', 'brandDesign/requestBrandDesignSystem.ts']) {
      const source = bridge(rel);
      expect(source, rel).not.toMatch(/from ['"](jspdf|pdf-lib|html2canvas)/);
    }
  });
});

describe('the design system a render is given', () => {
  /**
   * The six systems that are actually seeded, with the grounds they actually
   * carry — copied out of `brand_design_systems` rather than invented, because
   * the defect this pins is that these values existed in the column and never
   * reached the page.
   */
  const SEEDED = [
    {
      name: 'NPC Services Design System', brand_hex: '#D9A520',
      neutrals: {
        paper: '#FAF7EF', paperAlt: '#F2EBDE', paperBright: '#FFFDFA',
        field: '#251F18', rule: '#DDD1C0', bodyInk: '#312A21', mutedInk: '#6E6253',
      },
    },
    {
      name: 'Chancery', brand_hex: '#D9A521',
      neutrals: {
        paper: '#FFFDFA', paperAlt: '#F2EBDE', paperBright: '#FFFDFA',
        field: '#251F18', rule: '#DDD1C0', bodyInk: '#312A21', mutedInk: '#6E6253',
      },
    },
    {
      name: 'Broadsheet', brand_hex: '#D9A521',
      neutrals: {
        paper: '#FAF7EF', paperAlt: '#F7F0E4', paperBright: '#FFFDFA',
        field: '#251F18', rule: '#DDD1C0', bodyInk: '#312A21', mutedInk: '#6E6253',
      },
    },
    {
      name: 'Slip', brand_hex: '#D9A521',
      neutrals: {
        paper: '#FFFFFF', paperAlt: '#F5F3EF', paperBright: '#FFFFFF',
        field: '#312A21', rule: '#E4E0D8', bodyInk: '#312A21', mutedInk: '#6E6253',
      },
    },
    {
      name: 'Marque', brand_hex: '#D9A521',
      neutrals: {
        paper: '#FAF7EF', paperAlt: '#F8EED3', paperBright: '#FFFDFA',
        field: '#251F18', rule: '#DDD1C0', bodyInk: '#312A21', mutedInk: '#6E6253',
      },
    },
    {
      name: 'Cadastre', brand_hex: '#D9A521',
      neutrals: {
        paper: '#FFFDFA', paperAlt: '#EEF1F4', paperBright: '#FFFDFA',
        field: '#251F18', rule: '#D5DCE3', bodyInk: '#312A21', mutedInk: '#6E6253',
      },
    },
  ];

  /** What the route does with the row, in one place, as index.ts does it. */
  const paletteFor = (row: unknown) => {
    const choice = readDesignSystemRow(row);
    return {
      choice,
      palette: resolveReportPalette({
        preset: choice.options.preset,
        brandHex: choice.brandHex,
        neutrals: choice.neutrals,
      }),
    };
  };

  it('prints on the design system\'s own paper, not the preset\'s', () => {
    // The defect, stated directly. The route used to select four columns —
    // `id, name, brand_hex, options` — so `neutrals` never left the database.
    // Every conversion resolved to `PRESET_NEUTRALS`, and the four presets are
    // permutations of the same three constants, so an imported system showed
    // its real stock in the specimen gallery and printed on ours.
    const row = {
      name: 'Cadastre', brand_hex: '#D9A521',
      options: { preset: 'signature' },
      neutrals: SEEDED[5].neutrals,
    };
    const { palette } = paletteFor(row);
    expect(palette.paperAlt).toBe('#EEF1F4');
    expect(palette.rule).toBe('#D5DCE3');

    // And it is genuinely different from what the preset alone would give.
    const presetOnly = resolveReportPalette({ preset: 'signature', brandHex: '#D9A521' });
    expect(presetOnly.paperAlt).not.toBe(palette.paperAlt);
  });

  it('resolves every seeded system to a legible document', () => {
    for (const row of SEEDED) {
      const { choice, palette } = paletteFor({ ...row, options: { preset: 'signature' } });
      expect(choice.neutrals, row.name).not.toBeNull();
      expect(palette.paper, row.name).toBe(row.neutrals.paper);
      expect(palette.field, row.name).toBe(row.neutrals.field);
      expect(auditPaletteContrast(palette), row.name).toEqual([]);
    }
  });

  it('falls back to the preset whole when the grounds are unreadable', () => {
    // All seven or none. A half-read set would put somebody else's obsidian
    // cover on our ivory, which reads as a deliberate choice rather than as the
    // parse failure it is.
    const partial = { ...SEEDED[0].neutrals } as Record<string, unknown>;
    delete partial.mutedInk;
    for (const bad of [partial, { ...SEEDED[0].neutrals, rule: 'ivory' }, null, 'nope', 42]) {
      const { choice, palette } = paletteFor({
        name: 'Something', brand_hex: '#D9A521', options: { preset: 'signature' }, neutrals: bad,
      });
      expect(choice.neutrals, JSON.stringify(bad)).toBeNull();
      expect(palette.paper, JSON.stringify(bad))
        .toBe(resolveReportPalette({ preset: 'signature' }).paper);
      expect(auditPaletteContrast(palette)).toEqual([]);
    }
  });

  it('reads a missing row as the house default, exactly as before', () => {
    // `designSystemId: null` is the commonest case by far and must not move.
    for (const nothing of [null, undefined, 'row', 7]) {
      const choice = readDesignSystemRow(nothing);
      expect(choice.systemName, String(nothing)).toBe('House design');
      expect(choice.brandHex, String(nothing)).toBeNull();
      expect(choice.neutrals, String(nothing)).toBeNull();
      expect(choice.options, String(nothing)).toEqual(DEFAULT_REPORT_DESIGN_OPTIONS);
    }
  });

  it('normalises the options column rather than trusting it', () => {
    const choice = readDesignSystemRow({
      name: '  Harbour Editorial  ',
      brand_hex: '#1F4E79',
      options: { preset: 'not_a_preset', density: 'compact' },
    });
    expect(choice.systemName).toBe('Harbour Editorial');
    expect(choice.brandHex).toBe('#1F4E79');
    expect(choice.options.density).toBe('compact');
    expect(choice.options.preset).toBe(DEFAULT_REPORT_DESIGN_OPTIONS.preset);
  });

  it('corrects the accent against the imported stock, not against ours', () => {
    // What makes an import safe rather than merely possible. The same brand
    // colour resolves differently on different paper, because it has to.
    const onWhite = paletteFor({
      name: 'Slip', brand_hex: '#D9A521', options: { preset: 'signature' },
      neutrals: SEEDED[3].neutrals,
    }).palette;
    const onIvory = paletteFor({
      name: 'NPC', brand_hex: '#D9A521', options: { preset: 'signature' },
      neutrals: SEEDED[0].neutrals,
    }).palette;
    expect(auditPaletteContrast(onWhite)).toEqual([]);
    expect(auditPaletteContrast(onIvory)).toEqual([]);
  });
});

describe('the seeded design systems are not each other', () => {
  /**
   * Read against the migrations rather than a fixture.
   *
   * The seeded systems exist only as SQL — there is no const to import — so a
   * fixture here would be a second copy of the rows and would drift from
   * production the first time either moved. Parsing the migration is the only
   * way this assertion is about what is actually in the database.
   */
  const migration = (name: string) =>
    readFileSync(resolve(__dirname, '..', '..', '..', '..', '..', 'supabase', 'migrations', name), 'utf8');

  const SEED = '20260825000100_seed_house_design_systems.sql';
  const CHANCERY_FIX = '20260826000000_chancery_is_not_the_house_system.sql';

  /**
   * The seeded rows, by slug.
   *
   * Keyed on the slug rather than matched by value, which is the whole point:
   * two rows carrying the *same* options string is the defect, so any parse
   * that dedupes or matches on the string cannot see it. (My first version of
   * this test did exactly that and reported a second duplicate that was its own
   * substitution.)
   */
  const seededRows = (): Array<{ slug: string; options: string; neutrals: string }> =>
    [...migration(SEED).matchAll(
      /'([a-z-]+)',\s*'[^']*',\s*'(#[0-9A-Fa-f]{6})',\s*'(\{"preset":[^']+\})'::jsonb,\s*'(\{"paper":[^']+\})'::jsonb/g,
    )].map((m) => ({ slug: m[1], options: m[3], neutrals: m[4] }));

  it('gives no two systems the same set of design decisions', () => {
    // The defect. Chancery's options were byte-identical to the NPC Services
    // row's — every axis, every flag — so the only thing between them was three
    // units of lightness on the paper, and picking one over the other changed
    // nothing anybody could see. It was reported as the design system having no
    // effect, which is exactly what it was.
    const rows = seededRows();
    expect(rows.map((r) => r.slug)).toContain('chancery');
    expect(rows.length).toBeGreaterThanOrEqual(6);

    // In the seed as it stands, before the fix.
    const npc = rows.find((r) => r.slug === 'npc-services-design-system')!;
    const chancery = rows.find((r) => r.slug === 'chancery')!;
    expect(chancery.options).toBe(npc.options);

    const [next] = [...migration(CHANCERY_FIX).matchAll(/'(\{"preset":[^']+\})'::jsonb/g)].map((m) => m[1]);
    const applied = rows.map((r) => (r.slug === 'chancery' ? next : r.options));
    expect(new Set(applied).size).toBe(applied.length);
  });

  it('leaves a system somebody has edited alone', () => {
    // The WHERE clause is the whole safety of an UPDATE against seeded data. It
    // has to match the seed byte for byte or it silently updates nothing, and it
    // has to be there at all or it overwrites somebody's work.
    const sql = migration(CHANCERY_FIX);
    const matched = [...sql.matchAll(/'(\{"preset":[^']+\})'::jsonb/g)].map((m) => m[1]);
    expect(matched).toHaveLength(2);
    expect(seededRows().find((r) => r.slug === 'chancery')!.options).toBe(matched[1]);
    expect(sql).toContain("WHERE slug = 'chancery'");
  });

  it('resolves every seeded palette to a legible document', () => {
    // Options are only half of a system. The grounds have to clear the contrast
    // floor too, and a new row added to the seed without checking is how an
    // illegible document ships.
    for (const row of seededRows()) {
      const choice = readDesignSystemRow({
        name: row.slug, brand_hex: '#D9A521',
        options: JSON.parse(row.options), neutrals: JSON.parse(row.neutrals),
      });
      expect(choice.neutrals, row.slug).not.toBeNull();
      const palette = resolveReportPalette({
        preset: choice.options.preset, brandHex: choice.brandHex, neutrals: choice.neutrals,
      });
      expect(auditPaletteContrast(palette), row.slug).toEqual([]);
    }
  });
});
