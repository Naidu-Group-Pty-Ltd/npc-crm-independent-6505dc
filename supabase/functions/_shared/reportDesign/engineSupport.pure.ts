/**
 * What the render engine can actually do, as a checkable list.
 *
 * ## Why this exists
 *
 * The stylesheet was verified against WeasyPrint 69 on a developer's machine
 * and printed for clients by WeasyPrint 62.3 in the render container. Those two
 * do not agree, and the disagreement was invisible: 62.3 rejects
 * `width: calc(210mm - 44mm)` as an invalid value and carries on, so the cover's
 * `table-layout: fixed` had no width to be fixed to, the row auto-sized to its
 * content, and the classification and the reference printed as one word. The fix
 * for that had been *shipped and visually verified* a day earlier, against the
 * wrong engine.
 *
 * A property the engine ignores is the worst kind of defect this programme
 * produces: nothing throws, nothing is red, the document simply comes out
 * subtly wrong and only a person looking at the page can tell.
 *
 * ## Three lists, and why they are separate
 *
 * `UNSUPPORTED` — the engine drops it. Every entry was found by rendering a
 * probe, not by reading a support table.
 *
 * `DISCOURAGED` — the engine renders it, and the generator emits it anyway at
 * its peril. One entry: `calc()`. It works on the pinned engine and did not
 * work on the engine this service ran until now, which makes it the one
 * construct whose correctness depends on a number in `requirements.txt`.
 *
 * `LOAD_BEARING` — the engine must render it. These are not warnings; if the
 * engine ever stops honouring `display: grid` the reports stop being reports.
 * Nothing checks a *capability* until it disappears, so this list is the check.
 *
 * ## The list cannot rot
 *
 * Every entry carries a `probe` — the declaration that proves it — and the
 * render container answers `POST /capabilities` with which of a supplied set it
 * dropped. `reconcileCapabilities` compares the two, so the deployed engine
 * grades this file rather than the other way round.
 *
 * Keep `PINNED_ENGINE` in step with `weasyprint-service/requirements.txt`. A
 * spec reads that file and fails if they drift.
 */

/** The version `weasyprint-service` installs. Read from requirements by a spec. */
export const PINNED_ENGINE = '69.0';

export interface EngineConstruct {
  /** Stable key. Matches `DEFAULT_PROBES` in `weasyprint-service/app.py`. */
  id: string;
  /** One declaration, without its semicolon, that exercises the construct. */
  probe: string;
  /** Matches the generated CSS. Deliberately narrow. */
  pattern: RegExp;
  /** What to write instead. Read straight out of a failing spec. */
  instead: string;
  /** Why it is not supported, and how it fails. */
  note: string;
}

/**
 * Constructs the engine drops, with what to write instead.
 *
 * The failure mode is always the same — a warning on stderr nobody read, and a
 * document that is wrong in a way no test asserts on. The container now returns
 * those warnings; this list is what stops them being generated at all.
 */
export const UNSUPPORTED: readonly EngineConstruct[] = [
  {
    id: 'box-shadow',
    probe: 'box-shadow: 0 1pt 2pt currentColor',
    pattern: /\bbox-shadow\s*:/,
    instead: 'a gradient fill and a hairline border',
    note:
      'Unknown property in every version tested. The SVG renderer ignores '
      + 'feGaussianBlur too, so there is no vector route to a soft shadow at '
      + 'all — and on paper an elevation cue reads as a printing fault anyway.',
  },
  {
    id: 'filter',
    probe: 'filter: blur(2px)',
    pattern: /(^|[^-])\bfilter\s*:/,
    instead: 'a pre-composed asset, or nothing',
    note: 'Unknown property. blur(), saturate() and friends are silently ignored.',
  },
  {
    id: 'backdrop-filter',
    probe: 'backdrop-filter: blur(2px)',
    pattern: /\bbackdrop-filter\s*:/,
    instead: 'a solid or gradient scrim',
    note: 'Unknown property.',
  },
  {
    id: 'word-break-break-word',
    probe: 'word-break: break-word',
    pattern: /\bword-break\s*:\s*break-word\b/,
    instead: 'overflow-wrap: anywhere',
    note:
      'break-word is a non-standard value the engine rejects as invalid; '
      + 'overflow-wrap: anywhere is the supported spelling and does the work. '
      + 'This is what keeps a 51-character filename inside the cover trim.',
  },
  {
    id: 'position-sticky',
    probe: 'position: sticky',
    pattern: /\bposition\s*:\s*sticky\b/,
    instead: 'a repeated table header (thead is already display: table-header-group)',
    note: 'Invalid value in paged media. There is no viewport to stick to.',
  },
  {
    id: 'text-wrap-balance',
    probe: 'text-wrap: balance',
    pattern: /\btext-wrap\s*:/,
    instead: 'a shorter heading, or a size step in the type scale',
    note:
      'Unknown property. Balanced headings have to come from the copy and the '
      + 'measure, which is what coverTitleFit does.',
  },
  {
    id: 'aspect-ratio',
    probe: 'aspect-ratio: 16 / 9',
    pattern: /\baspect-ratio\s*:/,
    instead: 'an explicit height in mm, or an SVG viewBox',
    note:
      'Unknown property. Every figure in the design system is drawn as SVG with '
      + 'a viewBox, which carries its ratio intrinsically.',
  },
  {
    id: 'font-synthesis',
    probe: 'font-synthesis: none',
    pattern: /\bfont-synthesis\s*:/,
    instead: 'pin font-weight to a cut that ships',
    note:
      'Unknown property. It is the declaration that says "fall back visibly '
      + 'rather than fake it", and without it Pango emboldens or slants a face '
      + 'that has no such cut — a smear nothing downstream can detect. Only the '
      + '400 italic of the accent family ships, so every italic rule pins 400 '
      + 'rather than inheriting a heading weight there is no italic for. Found '
      + 'by rendering: the engine names it on stderr and renders on.',
  },
  {
    id: 'hyphenate-limit-lines',
    probe: 'hyphenate-limit-lines: 2',
    pattern: /\bhyphenate-limit-lines\s*:/,
    instead: 'nothing — the engine has no ladder control',
    note:
      'Unknown property, though `hyphenate-limit-chars` beside it is accepted. '
      + 'So a run of consecutive hyphenated line-endings cannot be limited on '
      + 'this engine; the character limits are what keep hyphenation from '
      + 'becoming the other kind of eyesore.',
  },
  {
    id: 'mix-blend-mode',
    probe: 'mix-blend-mode: multiply',
    pattern: /\bmix-blend-mode\s*:/,
    instead: 'a pre-mixed colour from the palette',
    note:
      'Unknown property. A tint that depends on blending is a tint nobody can '
      + 'check for print contrast, which is the whole point of resolving the '
      + 'palette up front.',
  },
  {
    id: 'writing-mode',
    probe: 'writing-mode: vertical-rl',
    pattern: /\bwriting-mode\s*:/,
    instead: 'a rotated SVG text element',
    note: 'Unknown property. Rotation in the drawings is done with a transform.',
  },
];

/**
 * Renders on the pinned engine, and still must not be generated.
 *
 * `calc()` is the entire list, and it is here because of what it cost. Every
 * length in this stylesheet is derived from a constant TypeScript already
 * holds, so there is nothing `calc()` can express that the generator cannot —
 * and using it makes the document's correctness depend on which engine happens
 * to be installed. That is a bet this programme has already lost once.
 */
export const DISCOURAGED: readonly EngineConstruct[] = [
  {
    id: 'calc-width',
    probe: 'width: calc(210mm - 44mm)',
    pattern: /\bcalc\(/,
    instead: 'compute the value in TypeScript and emit a number',
    note:
      'Accepted by 69 and rejected outright by 62.3 — "invalid value" — so it '
      + 'survives review on a developer machine and is dropped on the render '
      + 'host. That is exactly how the cover masthead shipped broken.',
  },
];

/**
 * The engine must render these, or the design system does not work.
 *
 * A capability is never noticed until it goes, so it is asserted rather than
 * assumed: `reconcileCapabilities` fails if the deployed engine reports any of
 * them as dropped. `pattern` is unused for this list and matches the
 * declaration itself, so an entry is still self-describing.
 */
export const LOAD_BEARING: readonly EngineConstruct[] = [
  {
    id: 'flex',
    probe: 'display: flex',
    pattern: /\bdisplay\s*:\s*flex\b/,
    instead: '',
    note: 'The KPI strip, the two-column and the sidenote all lay out on it.',
  },
  {
    id: 'grid',
    probe: 'display: grid',
    pattern: /\bdisplay\s*:\s*grid\b/,
    instead: '',
    note: 'renderGrid12 is the twelve-column grid every composed page sits on.',
  },
  {
    id: 'border-radius',
    probe: 'border-radius: 3pt',
    pattern: /\bborder-radius\s*:/,
    instead: '',
    note: 'The raised surface style is rounded containers and nothing else.',
  },
  {
    id: 'linear-gradient',
    probe: 'background: linear-gradient(currentColor, transparent)',
    pattern: /\blinear-gradient\(/,
    instead: '',
    note:
      'The only elevation cue available once box-shadow is gone: a card is a '
      + 'gradient fill and a hairline.',
  },
  {
    id: 'hyphens',
    probe: 'hyphens: auto',
    pattern: /\bhyphens\s*:/,
    instead: '',
    note:
      'Justified body copy at this measure rags badly without it. Needs the '
      + 'document lang as well, which renderDocument sets.',
  },
  {
    id: 'hyphenate-limit-chars',
    probe: 'hyphenate-limit-chars: 6 3 3',
    pattern: /\bhyphenate-limit-chars\s*:/,
    instead: '',
    note:
      'Without it, hyphenation breaks four-letter words and leaves a single '
      + 'letter before the hyphen. Its sibling `hyphenate-limit-lines` is an '
      + 'unknown property on this engine, so this is the only control there is.',
  },
  {
    id: 'bookmark-level',
    probe: 'bookmark-level: 1',
    pattern: /\bbookmark-level\s*:/,
    instead: '',
    note:
      'The PDF outline. Without it a twenty-nine page report opens with an '
      + 'empty bookmarks pane, and a screen reader has no structure to '
      + 'navigate by — which makes it part of the accessibility claim rather '
      + 'than a convenience.',
  },
  {
    id: 'break-inside',
    probe: 'break-inside: avoid',
    pattern: /\bbreak-inside\s*:/,
    instead: '',
    note: 'What stops a KPI card or a callout being split across two sheets.',
  },
  {
    id: 'running-string',
    probe: 'content: string(chapter)',
    pattern: /\bstring\(/,
    instead: '',
    note: 'The running head names the chapter it is on. Nothing else can do this.',
  },
];

export interface EngineFinding {
  /** Which construct. Matches a container probe key. */
  id: string;
  instead: string;
  note: string;
  /** The offending text, trimmed, so a failure names the line. */
  found: string;
}

/** Comments stripped: a lint that fires on its own documentation gets deleted. */
function withoutComments(css: string): string {
  return String(css ?? '').replace(/\/\*[\s\S]*?\*\//g, ' ');
}

/**
 * Everything in a stylesheet the pinned engine will drop, or that must not be
 * written even though it would render.
 *
 * Returns an empty array for a sheet the engine renders whole.
 */
export function findUnsupportedCss(css: string): EngineFinding[] {
  const source = withoutComments(css);
  const out: EngineFinding[] = [];
  for (const rule of [...UNSUPPORTED, ...DISCOURAGED]) {
    // Fresh regex per call: a shared /g would carry lastIndex between sheets.
    const re = new RegExp(rule.pattern.source, 'g');
    const m = re.exec(source);
    if (!m) continue;
    const end = source.indexOf(';', m.index);
    const line = source.slice(m.index, end >= 0 ? end + 1 : m.index + 60);
    // One report per construct; the spec names the fix, not every site.
    out.push({ id: rule.id, instead: rule.instead, note: rule.note, found: line.trim().slice(0, 120) });
  }
  return out;
}

/** The findings as a failure message somebody can act on without opening this file. */
export function describeEngineFindings(findings: readonly EngineFinding[]): string {
  return findings
    .map((f) => `  ${f.found}\n    → ${f.instead || 'this must not appear at all'}\n    ${f.note}`)
    .join('\n');
}

/** `{ id: declaration }`, the body of a `POST /capabilities` probe request. */
export function engineProbes(): Record<string, string> {
  const probes: Record<string, string> = {};
  for (const rule of [...UNSUPPORTED, ...DISCOURAGED, ...LOAD_BEARING]) probes[rule.id] = rule.probe;
  return probes;
}

/**
 * `write_pdf` options the render path depends on.
 *
 * The three lists above cover CSS declarations only, so an engine upgrade that
 * dropped or renamed an *option* was invisible to this file — and every option
 * the service sends is a keyword argument, which means a renamed one is a
 * `TypeError` at render time on a production route rather than a warning.
 *
 * `/capabilities` has returned `sorted(DEFAULT_OPTIONS)` since it was written
 * and nothing read it. This is the list to check it against: the ones this repo
 * actually sends, not all nineteen.
 */
export const REQUIRED_OPTIONS: readonly string[] = [
  'pdf_variant',
  // The colour space the file declares it was prepared for. The PDF/A variants
  // set this themselves; `pdf/ua-1` does not, because accessibility says
  // nothing about colour — so the switch to UA dropped the output intent from
  // every report until the service began asking for it by name.
  'output_intent',
  // The knob that actually produces `/StructTreeRoot`. The service read
  // `tagged` from the body and did not pass it for a while, so every report it
  // produced was untagged — valid, printable, and unnavigable to a screen
  // reader. A rename here would silently do the same thing again.
  'pdf_tags',
  // Carries the document's own `<meta name=…>` tags into the file, which is
  // the only thing connecting a delivered PDF back to the row that produced
  // it. Losing it would not break a render or move a pixel.
  'custom_metadata',
  'optimize_images',
  'presentational_hints',
];

export interface CapabilityReconciliation {
  /** Load-bearing constructs the deployed engine drops. A broken renderer. */
  broken: string[];
  /** Listed as unsupported and now rendered. News, not a defect — move it. */
  stale: string[];
  /** Discouraged constructs the engine also drops. Doubly not to be written. */
  alsoDropped: string[];
  /** Probed and not answered: the container is older than this file. */
  unanswered: string[];
  /**
   * `write_pdf` options this repo sends that the engine no longer accepts.
   *
   * Empty when the container did not report its options at all, which is what
   * an older container does — that case lands in `unansweredOptions`.
   */
  missingOptions: string[];
  /** True when the container reported no options list to check against. */
  unansweredOptions: boolean;
}

/**
 * Grade this file against the engine that is actually deployed.
 *
 * `dropped` is the container's answer — `{ id: true }` for a declaration it
 * ignored. `broken` is the only entry that means something is wrong *now*;
 * `stale` means the engine has moved on and this list has not.
 */
export function reconcileCapabilities(
  dropped: Readonly<Record<string, boolean>>,
  engineOptions?: readonly string[] | null,
): CapabilityReconciliation {
  const answered = (id: string) => Object.prototype.hasOwnProperty.call(dropped, id);
  const all = [...UNSUPPORTED, ...DISCOURAGED, ...LOAD_BEARING];
  const known = engineOptions?.length ? new Set(engineOptions) : null;
  return {
    broken: LOAD_BEARING.filter((r) => answered(r.id) && dropped[r.id]).map((r) => r.id),
    stale: UNSUPPORTED.filter((r) => answered(r.id) && !dropped[r.id]).map((r) => r.id),
    alsoDropped: DISCOURAGED.filter((r) => answered(r.id) && dropped[r.id]).map((r) => r.id),
    unanswered: all.filter((r) => !answered(r.id)).map((r) => r.id),
    missingOptions: known ? REQUIRED_OPTIONS.filter((o) => !known.has(o)) : [],
    unansweredOptions: !known,
  };
}

/** True when the deployed engine agrees with this file about what it can do. */
export function capabilitiesAgree(result: CapabilityReconciliation): boolean {
  return result.broken.length === 0
    && result.stale.length === 0
    && result.unanswered.length === 0
    && result.missingOptions.length === 0;
}

/** The reconciliation as a message. Empty when everything agrees. */
export function describeReconciliation(result: CapabilityReconciliation): string {
  const lines: string[] = [];
  if (result.broken.length) {
    lines.push(
      `the deployed engine drops ${result.broken.join(', ')} — these are load-bearing `
      + 'and the reports will not lay out correctly',
    );
  }
  if (result.stale.length) {
    lines.push(
      `${result.stale.join(', ')} render on the deployed engine and are still listed as `
      + 'unsupported — move them out of UNSUPPORTED, or into DISCOURAGED with a reason',
    );
  }
  if (result.unanswered.length) {
    lines.push(
      `the container did not answer for ${result.unanswered.join(', ')} — it is probably `
      + 'older than this file',
    );
  }
  if (result.missingOptions.length) {
    lines.push(
      `the deployed engine does not accept ${result.missingOptions.join(', ')} — the render `
      + 'path sends these as keyword arguments, so this is a TypeError on a production route '
      + 'rather than a warning',
    );
  }
  if (result.alsoDropped.length) {
    lines.push(`${result.alsoDropped.join(', ')} are dropped as well as discouraged`);
  }
  return lines.join('\n');
}
