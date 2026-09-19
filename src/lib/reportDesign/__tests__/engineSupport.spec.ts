/**
 * Nothing the product can generate may contain CSS the render container drops.
 *
 * ## The defect this exists to stop happening twice
 *
 * The cover fix — a fixed-width masthead row so the classification and the
 * reference cannot collide — was written, rendered, read as an image and
 * shipped. It was verified against WeasyPrint 69, which is what a developer
 * machine installs. The container pins 62.3, which rejects
 * `width: calc(210mm - 44mm)` as an invalid value, drops the declaration, and
 * renders on. `table-layout: fixed` then has no width to fix to, the row
 * auto-sizes to its content, and the two cells print as one word.
 *
 * So the render succeeded, no test was red, and the document was wrong. The
 * only signal was a warning on the container's stderr that nothing reads.
 *
 * This spec closes that gap without an engine: `findUnsupportedCss` runs over
 * every stylesheet `buildReportCss` can produce, across every axis that
 * branches. `scripts/reports/engineCheck.mts` closes the rest of it by
 * rendering through the pinned version and failing on any warning at all.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DISCOURAGED,
  LOAD_BEARING,
  PINNED_ENGINE,
  REQUIRED_OPTIONS,
  UNSUPPORTED,
  capabilitiesAgree,
  describeEngineFindings,
  describeReconciliation,
  engineProbes,
  findUnsupportedCss,
  reconcileCapabilities,
} from '../engineSupport.pure';
import { buildReportCss } from '../css.pure';
import { resolveReportPalette, type ReportPreset } from '../brandResolve.pure';
import type {
  ReportChapterStyle,
  ReportCoverStyle,
  ReportDensity,
  ReportDesignOptions,
  ReportSurfaceStyle,
  ReportTableStyle,
} from '../options.pure';

const SERVICE = resolve(__dirname, '../../../../weasyprint-service');
const REQUIREMENTS = resolve(SERVICE, 'requirements.txt');
const DOCKERFILE = readFileSync(resolve(SERVICE, 'Dockerfile'), 'utf8');
const SERVICE_PY = readFileSync(resolve(SERVICE, 'app.py'), 'utf8');

/** `#` comments stripped — the prose names most of what these rules forbid. */
const dockerCode = DOCKERFILE.split('\n')
  .map((line) => line.replace(/(^|\s)#.*$/, ''))
  .join('\n');

describe('the pinned engine is one number, recorded once', () => {
  it('matches what the container installs', () => {
    const pin = readFileSync(REQUIREMENTS, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .find((line) => /^weasyprint\s*==/i.test(line));

    expect(pin, 'weasyprint is not pinned in requirements.txt').toBeTruthy();
    expect(
      pin,
      'PINNED_ENGINE has drifted from requirements.txt — a stylesheet verified '
      + 'against one version and printed by another is how the cover broke',
    ).toBe(`weasyprint==${PINNED_ENGINE}`);
  });

  it('pins every dependency exactly', () => {
    // A `>=` here is the same defect with a different spelling: the container
    // installs whatever it finds on the day it is rebuilt, and the stylesheet is
    // true against whatever was installed the day it was reviewed.
    const lines = readFileSync(REQUIREMENTS, 'utf8')
      .split('\n')
      .map((line) => line.replace(/#.*$/, '').trim())
      .filter(Boolean);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line, line).toMatch(/^[a-z0-9_.-]+==[\d][\w.]*$/i);
  });
});

/**
 * The image itself.
 *
 * These are shape assertions, not a substitute for building it — CI does that.
 * They exist because each one is a property that costs nothing while it holds
 * and is invisible when it stops: an unpinned base image moves distribution, a
 * root user is only noticed after something else goes wrong, and a warm-up that
 * quietly stops running just makes the first report of the day slow.
 */
describe('the render container', () => {
  it('pins every stage to a Debian release', () => {
    const stages = dockerCode.match(/^FROM\s+\S+/gm) ?? [];
    expect(stages.length).toBeGreaterThanOrEqual(2);
    for (const stage of stages) {
      expect(stage, stage).toMatch(/^FROM python:[\d.]+-slim-(bookworm|trixie)$/);
    }
  });

  it('builds the dependencies in one stage and runs them in another', () => {
    // The compiler and the headers are needed to install and must not ship.
    expect(dockerCode).toMatch(/FROM\s+\S+\s+AS\s+builder/i);
    expect(dockerCode).toMatch(/COPY\s+--from=builder\s+\/opt\/venv\s+\/opt\/venv/);
    const runtime = dockerCode.slice(dockerCode.lastIndexOf('FROM python:'));
    expect(runtime, 'the runtime stage installs a compiler').not.toMatch(/build-essential/);
  });

  it('renders as an unprivileged user', () => {
    expect(dockerCode).toMatch(/^USER\s+(?!root)\S+/m);
  });

  it('proves the engine by rendering, in the stage that has the libraries', () => {
    // An import proves the wheels installed. It does not prove Pango is there,
    // that fontconfig sees the brand faces, or that the faces resolve — and all
    // three fail silently. The first version of this check ran in the builder,
    // which has a compiler and no Pango, so `import weasyprint` failed and the
    // image could not be built at all.
    const runtime = dockerCode.slice(dockerCode.lastIndexOf('FROM python:'));
    expect(runtime).toMatch(/RUN\s+python\s+selfcheck\.py/);
    expect(existsSync(resolve(SERVICE, 'selfcheck.py'))).toBe(true);
    const builder = dockerCode.slice(0, dockerCode.lastIndexOf('FROM python:'));
    expect(builder, 'the builder has no native libraries to import against')
      .not.toMatch(/import weasyprint/);
  });

  it('can be probed for liveness from inside itself', () => {
    expect(dockerCode).toMatch(/HEALTHCHECK/);
    expect(dockerCode).toContain('/healthz');
  });

  it('forks its workers after the engine is loaded', () => {
    // Without --preload each worker imports and warms WeasyPrint separately,
    // which is both the memory and the first-render latency multiplied by the
    // worker count.
    expect(dockerCode).toMatch(/gunicorn[\s\S]*--preload/);
  });

  it('warms the engine at boot', () => {
    expect(dockerCode).toMatch(/WEASYPRINT_WARMUP=1/);
    expect(SERVICE_PY).toContain('def warm_up()');
  });

  it('returns the engine diagnostics the caller reads', () => {
    // `weasyprintClient.ts` reads these four by name. A rename on one side and
    // not the other degrades silently to "the engine reported nothing".
    for (const header of [
      'X-WeasyPrint-Warnings',
      'X-WeasyPrint-Warning-Count',
      'X-Pdf-Pages',
      'X-Pdf-Tagged',
    ]) {
      expect(SERVICE_PY, header).toContain(header);
    }
  });

  it('passes the option that actually writes a structure tree', () => {
    // The service read `tagged` from the request body and never handed it to
    // the engine, so every report it produced was untagged.
    expect(SERVICE_PY).toMatch(/"pdf_tags":\s*tagged/);
  });

  it('probes the same construct ids the repo lists', () => {
    // `reconcileCapabilities` matches on id. A container whose default probe
    // set uses different names answers a question nobody asked.
    const block = SERVICE_PY.slice(SERVICE_PY.indexOf('DEFAULT_PROBES = {'));
    for (const id of Object.keys(engineProbes())) {
      expect(block, `${id} is not in the container's DEFAULT_PROBES`).toContain(`"${id}":`);
    }
  });
});

describe('findUnsupportedCss', () => {
  it('finds a length the engine will not compute', () => {
    const [found] = findUnsupportedCss('.cover-row { width: calc(210mm - 44mm); }');
    expect(found.instead).toContain('TypeScript');
    expect(found.found).toContain('calc(210mm - 44mm)');
  });

  it.each([...UNSUPPORTED, ...DISCOURAGED].map((u) => u.id))('carries a fix for %s', (id) => {
    const rule = [...UNSUPPORTED, ...DISCOURAGED].find((u) => u.id === id)!;
    expect(rule.instead.trim().length, id).toBeGreaterThan(0);
    expect(rule.note.trim().length, id).toBeGreaterThan(0);
  });

  it('says nothing about a sheet the engine renders whole', () => {
    expect(findUnsupportedCss('.kpi { padding: 6pt 8pt; border-radius: 3pt; }')).toEqual([]);
  });

  it('ignores its own documentation', () => {
    // A lint that fires on the comment explaining the lint is a lint people
    // delete. This file, and `css.pure.ts`, both name these constructs in prose.
    expect(findUnsupportedCss('/* never write box-shadow or calc() here */ .a { color: red; }'))
      .toEqual([]);
  });

  it('does not read backdrop-filter as filter twice', () => {
    const found = findUnsupportedCss('.scrim { backdrop-filter: blur(4px); }');
    expect(found).toHaveLength(1);
    expect(found[0].instead).toContain('scrim');
  });

  it('does not carry lastIndex between sheets', () => {
    // A module-level /g regex reused across calls resumes where it stopped, so
    // the second sheet in a loop silently passes. Two identical sheets must
    // report identically.
    const sheet = '.a { width: calc(1mm + 1mm); }';
    expect(findUnsupportedCss(sheet)).toEqual(findUnsupportedCss(sheet));
  });

  it('names the offending declaration, not just the construct', () => {
    const message = describeEngineFindings(findUnsupportedCss('.a { box-shadow: 0 1pt 2pt #000; }'));
    expect(message).toContain('box-shadow: 0 1pt 2pt #000;');
    expect(message).toContain('→');
  });

  it('reports a construct the engine renders but the generator must not emit', () => {
    // `calc()` is the whole of DISCOURAGED and the reason this file exists.
    const [found] = findUnsupportedCss('.cover-row { width: calc(210mm - 44mm); }');
    expect(found.id).toBe('calc-width');
    expect(found.instead).toContain('TypeScript');
  });
});

/**
 * The half that keeps the lists honest.
 *
 * `POST /capabilities` on the render container answers, for a set of probe
 * declarations, which ones it dropped. That is the deployed engine grading this
 * file — the opposite direction from a support table, and the only direction
 * that cannot go stale.
 */
describe('reconciling against a deployed engine', () => {
  const drops = (ids: readonly string[]) =>
    Object.fromEntries(Object.keys(engineProbes()).map((id) => [id, ids.includes(id)]));

  it('probes every construct in all three lists', () => {
    const probes = engineProbes();
    for (const rule of [...UNSUPPORTED, ...DISCOURAGED, ...LOAD_BEARING]) {
      expect(probes[rule.id], rule.id).toBe(rule.probe);
    }
    // Distinct ids, or a probe silently overwrites another's answer.
    expect(Object.keys(probes)).toHaveLength(
      UNSUPPORTED.length + DISCOURAGED.length + LOAD_BEARING.length,
    );
  });

  it('agrees with an engine that behaves as recorded', () => {
    const result = reconcileCapabilities(drops(UNSUPPORTED.map((r) => r.id)));
    expect(describeReconciliation(result)).toBe('');
    expect(capabilitiesAgree(result)).toBe(true);
  });

  it('calls a dropped load-bearing construct broken', () => {
    const result = reconcileCapabilities(drops([...UNSUPPORTED.map((r) => r.id), 'grid']));
    expect(result.broken).toEqual(['grid']);
    expect(capabilitiesAgree(result)).toBe(false);
    expect(describeReconciliation(result)).toContain('load-bearing');
  });

  it('calls a newly supported construct stale, not broken', () => {
    // The engine gaining `aspect-ratio` is news, not a defect — but a list that
    // still forbids it is one people work around rather than update.
    const result = reconcileCapabilities(
      drops(UNSUPPORTED.filter((r) => r.id !== 'aspect-ratio').map((r) => r.id)),
    );
    expect(result.stale).toEqual(['aspect-ratio']);
    expect(result.broken).toEqual([]);
    expect(describeReconciliation(result)).toContain('still listed as unsupported');
  });

  it('says so when the container is older than this file', () => {
    const result = reconcileCapabilities({ grid: false });
    expect(result.unanswered).toContain('box-shadow');
    expect(capabilitiesAgree(result)).toBe(false);
  });

  /**
   * The other half of what an engine can do.
   *
   * The three lists are CSS declarations, so an upgrade that renamed or removed
   * a `write_pdf` **option** was invisible here — and every option the service
   * sends is a keyword argument, which makes a renamed one a `TypeError` on a
   * production route rather than a warning on stderr. `/capabilities` has
   * returned `sorted(DEFAULT_OPTIONS)` since it was written, and until now
   * nothing read it.
   */
  describe('the options, not just the declarations', () => {
    const clean = drops(UNSUPPORTED.map((r) => r.id));

    it('agrees with an engine that accepts everything the render path sends', () => {
      const result = reconcileCapabilities(clean, [...REQUIRED_OPTIONS, 'dpi', 'jpeg_quality']);
      expect(result.missingOptions).toEqual([]);
      expect(result.unansweredOptions).toBe(false);
      expect(capabilitiesAgree(result)).toBe(true);
    });

    it('fails when the engine has dropped one this repo sends', () => {
      const result = reconcileCapabilities(
        clean,
        REQUIRED_OPTIONS.filter((o) => o !== 'pdf_variant'),
      );
      expect(result.missingOptions).toEqual(['pdf_variant']);
      expect(capabilitiesAgree(result)).toBe(false);
      expect(describeReconciliation(result)).toContain('TypeError');
    });

    it('says nothing rather than claiming an option is missing, when unanswered', () => {
      // An older container reports no options at all — and the local route
      // cannot report them either, because it renders through the CLI and
      // cannot introspect a Python signature. That is a different fact from
      // "the engine dropped four of them", and reporting it as the latter would
      // send somebody looking for a break that is not there. It is flagged on
      // the result for `engineCheck.mts` to note, and it is not a disagreement.
      const result = reconcileCapabilities(clean);
      expect(result.missingOptions).toEqual([]);
      expect(result.unansweredOptions).toBe(true);
      expect(describeReconciliation(result)).toBe('');
      expect(capabilitiesAgree(result)).toBe(true);
    });

    it('names only options the render path actually sends', () => {
      // Not all nineteen the engine has. A gate on an option nothing uses is a
      // gate that fails for a change nobody made.
      const client = readFileSync(
        resolve(__dirname, '../../../../supabase/functions/_shared/weasyprintClient.ts'),
        'utf8',
      );
      const app = readFileSync(
        resolve(__dirname, '../../../../weasyprint-service/app.py'),
        'utf8',
      );
      for (const option of REQUIRED_OPTIONS) {
        expect(
          client.includes(option) || app.includes(option),
          `${option} is required of the engine but nothing sends it`,
        ).toBe(true);
      }
    });
  });
});

/**
 * Every axis that changes the emitted CSS, crossed.
 *
 * `bodyScale` and `visualIntensity` change numbers inside declarations rather
 * than which declarations exist, so they are sampled at their extremes rather
 * than swept — a `calc()` does not appear at 97% and vanish at 98%.
 */
const PRESETS: readonly ReportPreset[] = [
  'signature', 'editorial_navy', 'minimal_ink', 'high_contrast',
];
const SURFACES: readonly ReportSurfaceStyle[] = ['flat', 'raised'];
const COVERS: readonly ReportCoverStyle[] = ['image', 'title_overlay', 'editorial'];
const TABLES: readonly ReportTableStyle[] = ['classic', 'ledger', 'minimal'];
const CHAPTERS: readonly ReportChapterStyle[] = ['classic', 'opener_band', 'minimal'];
const DENSITIES: readonly ReportDensity[] = ['compact', 'balanced', 'spacious'];

function* everySheet(): Generator<{ label: string; css: string }> {
  for (const preset of PRESETS) {
    const palette = resolveReportPalette({ preset });
    for (const surfaceStyle of SURFACES) {
      for (const coverStyle of COVERS) {
        for (const tableStyle of TABLES) {
          for (const chapterStyle of CHAPTERS) {
            for (const density of DENSITIES) {
              for (const extremes of [
                { bodyScale: 85, visualIntensity: 0, showDropCaps: false, justifyText: false },
                { bodyScale: 115, visualIntensity: 100, showDropCaps: true, justifyText: true },
              ] as Partial<ReportDesignOptions>[]) {
                const options = {
                  preset, surfaceStyle, coverStyle, tableStyle, chapterStyle, density, ...extremes,
                };
                yield {
                  label: [preset, surfaceStyle, coverStyle, tableStyle, chapterStyle, density,
                    `${extremes.bodyScale}%`].join('/'),
                  css: buildReportCss({ palette, options, masthead: 'Acme Advisory · Analysis' }),
                };
              }
            }
          }
        }
      }
    }
  }
}

describe('every stylesheet the product can generate renders whole on the pinned engine', () => {
  it('sweeps the full cross-product', () => {
    const broken: string[] = [];
    let sheets = 0;

    for (const { label, css } of everySheet()) {
      sheets += 1;
      const findings = findUnsupportedCss(css);
      if (findings.length) broken.push(`${label}\n${describeEngineFindings(findings)}`);
    }

    // Guards the sweep itself: a generator that yields nothing passes silently.
    expect(sheets).toBe(
      PRESETS.length * SURFACES.length * COVERS.length * TABLES.length
      * CHAPTERS.length * DENSITIES.length * 2,
    );
    expect(broken.join('\n\n'), `${broken.length} of ${sheets} stylesheets carry dropped CSS`)
      .toBe('');
  });

  it('sweeps a brought palette too', () => {
    // An imported design system supplies its own neutrals, and the raised rules
    // derive tints from them. Same sheet shape, different numbers — but a
    // number is exactly what a length function would be hiding in.
    const palette = resolveReportPalette({
      brandHex: '#2F5D8C',
      neutrals: {
        paper: '#FFFFFF', paperAlt: '#F4F4F5', paperBright: '#FFFFFF',
        field: '#111827', rule: '#D4D4D8', bodyInk: '#18181B', mutedInk: '#52525B',
      },
    });
    const css = buildReportCss({
      palette,
      options: { surfaceStyle: 'raised' },
      masthead: 'Acme Advisory · Analysis',
    });
    expect(describeEngineFindings(findUnsupportedCss(css))).toBe('');
  });
});
