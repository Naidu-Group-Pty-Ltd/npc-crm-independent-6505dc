/**
 * Ask the render engine what it did with a document, and fail if it dropped
 * anything.
 *
 * ```
 *   npx tsx scripts/reports/engineCheck.mts <file.html> [<file.html> …]
 *   npx tsx scripts/reports/engineCheck.mts --capabilities
 *   npx tsx scripts/reports/engineCheck.mts --service http://localhost:8080 --token <t> [files…]
 * ```
 *
 * ## Why a script and not a spec
 *
 * `engineSupport.spec.ts` reads the stylesheets the product generates and
 * refuses the constructs the engine is known to drop. That catches everything
 * on a list — and the defect this whole exercise came from was not on a list.
 * It was `width: calc(210mm - 44mm)`, dropped by the deployed engine and
 * rendered by the local one, and nothing knew to look for it because nobody had
 * met it yet.
 *
 * So this is the other half: render, and fail on *any* warning, listed or not.
 * Everything WeasyPrint ignores it says so about, once — the only reason that
 * was never a gate is that nothing was reading it.
 *
 * ## Which engine
 *
 * `--service` asks a *running render container*, which is the only form of this
 * check that answers the question that matters: what does the engine our
 * clients' reports actually go through do with this document. Without it the
 * engine is whatever `weasyprint` is on PATH — still worth checking, as long as
 * it is not mistaken for the other thing. When that binary is not the pinned
 * version this says so and carries on.
 *
 * `--capabilities` runs the probe set from `engineSupport.pure.ts` and
 * reconciles it against what the engine actually does, which is how that file
 * learns it has gone stale.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  PINNED_ENGINE,
  capabilitiesAgree,
  describeReconciliation,
  engineProbes,
  reconcileCapabilities,
} from '../../supabase/functions/_shared/reportDesign/engineSupport.pure.ts';

const argv = process.argv.slice(2);
const VALUED = new Set(['--service', '--token']);

function flag(name: string): string | undefined {
  const at = argv.indexOf(name);
  return at >= 0 ? argv[at + 1] : undefined;
}

const wantCapabilities = argv.includes('--capabilities');
const service = flag('--service')?.replace(/\/$/, '');
const token = flag('--token') ?? process.env.WEASYPRINT_SERVICE_TOKEN ?? '';
const inputs = argv.filter((arg, index) => {
  if (arg.startsWith('--')) return false;
  return !VALUED.has(argv[index - 1] ?? '');
});

if (!wantCapabilities && inputs.length === 0) {
  console.error(
    'usage: engineCheck.mts <file.html> [...] | --capabilities '
    + '[--service <url> --token <t>]',
  );
  process.exit(2);
}

const workDir = mkdtempSync(join(tmpdir(), 'engine-check-'));

/** `Ignored ...` and friends. Everything WeasyPrint says it did not do. */
const IGNORED = /^\s*(WARNING|ERROR):/;

interface RenderReport {
  warnings: string[];
  engine: string;
  pages: number | null;
  tagged: boolean | null;
}

function localEngine(): string {
  try {
    // `weasyprint --version` prints e.g. "WeasyPrint version 69.0".
    const out = execFileSync('weasyprint', ['--version'], { encoding: 'utf8' });
    return (/([\d]+\.[\d.]+)/.exec(out)?.[1] ?? 'unknown').trim();
  } catch {
    return 'unknown';
  }
}

/**
 * Whether the local build knows the flag that writes a structure tree.
 *
 * Asked rather than assumed, because the answer is the story: 62.3 has no
 * `--pdf-tags` and no `pdf_tags` option, so every report the service produced
 * on that engine was untagged no matter what the caller sent.
 */
function localSupportsTagging(): boolean {
  try {
    return execFileSync('weasyprint', ['--help'], { encoding: 'utf8' }).includes('--pdf-tags');
  } catch {
    return false;
  }
}

const LOCAL_TAGGING = service ? true : localSupportsTagging();

/**
 * Render locally, and return the lines the engine wrote about what it ignored.
 *
 * `spawnSync` rather than `execFileSync` because the interesting output is on
 * stderr and the process exits 0 — `execFileSync` hands back stdout and drops
 * stderr on success, which is a small-scale version of the same mistake this
 * script exists to correct.
 */
function renderLocally(html: string, label: string): RenderReport {
  const out = join(workDir, `${label}.pdf`);
  const run = spawnSync(
    'weasyprint',
    [...(LOCAL_TAGGING ? ['--pdf-tags'] : []), '-v', html, out],
    { encoding: 'utf8' },
  );
  if (run.error) throw new Error(`could not run weasyprint: ${run.error.message}`);
  if (run.status !== 0) {
    throw new Error(`render failed for ${label} (exit ${run.status}): ${run.stderr?.trim()}`);
  }
  return {
    warnings: `${run.stderr ?? ''}`
      .split('\n')
      .filter((line) => IGNORED.test(line))
      .map((line) => line.trim()),
    engine: localEngine(),
    pages: null,
    tagged: LOCAL_TAGGING,
  };
}

/**
 * Render through a running container, and read the diagnostics it returns.
 *
 * The request is the one the nine render routes make, deliberately — variant,
 * output intent and all. This script exists to find out what the deployed
 * engine does to a *report*, and it spent a while asking about `pdf/a-2b`, a
 * variant no report has used since the claim moved to PDF/UA-1. A gate that
 * probes a path production does not take can pass while production is broken.
 *
 * `weasyprintClient.ts` is the source of truth for these; a spec asserts the
 * two agree. Not imported: this is a build script and that module is Deno-side
 * edge-function code.
 */
async function renderOnService(html: string): Promise<RenderReport> {
  const res = await fetch(`${service}/render`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      html, pdf_variant: 'pdf/ua-1', output_intent: 'srgb', tagged: true,
    }),
  });
  if (!res.ok) throw new Error(`${service} answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
  await res.arrayBuffer();
  const raw = res.headers.get('X-WeasyPrint-Warnings');
  const pages = Number(res.headers.get('X-Pdf-Pages'));
  return {
    warnings: raw ? (JSON.parse(raw) as string[]) : [],
    engine: res.headers.get('X-WeasyPrint-Version') ?? 'unknown',
    pages: Number.isFinite(pages) ? pages : null,
    tagged: res.headers.get('X-Pdf-Tagged') === '1',
  };
}

/** Which of the probe declarations this engine dropped. */
async function probe(): Promise<{
  dropped: Record<string, boolean>;
  engine: string;
  /** `write_pdf` keyword arguments the engine accepts. Null when not reported. */
  options: string[] | null;
}> {
  const probes = engineProbes();
  if (service) {
    const res = await fetch(`${service}/capabilities`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ probes }),
    });
    if (!res.ok) {
      throw new Error(`${service} answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    const body = await res.json() as {
      dropped: Record<string, boolean>;
      weasyprint: string;
      options?: string[];
    };
    // `/capabilities` has returned this since it was written and nothing read
    // it. Every option the service sends is a keyword argument, so one the
    // engine has renamed is a TypeError on a production route.
    return { dropped: body.dropped, engine: body.weasyprint, options: body.options ?? null };
  }

  const rules = Object.entries(probes)
    .map(([id, decl], index) => `.p${index} { ${decl}; } /* ${id} */`)
    .join('\n');
  const file = join(workDir, 'probe.html');
  writeFileSync(
    file,
    `<html lang="en"><head><style>${rules}</style></head><body><p>probe</p></body></html>`,
  );
  const said = renderLocally(file, 'probe').warnings.join('\n');
  return {
    dropped: Object.fromEntries(
      Object.entries(probes).map(([id, decl]) => [id, said.includes(decl.trim())]),
    ),
    engine: localEngine(),
    // The local route renders through the CLI and cannot introspect the
    // Python API's signature. Only `--service` can answer for options.
    options: null,
  };
}

async function main(): Promise<number> {
  if (!service) {
    if (!LOCAL_TAGGING) {
      console.warn(
        '! this engine has no --pdf-tags, so it cannot write a structure tree at all. '
        + 'Reports rendered on it are untagged whatever the caller asks for.',
      );
    }
    const engine = localEngine();
    if (engine !== PINNED_ENGINE) {
      console.warn(
        `! this engine is ${engine} and the container pins ${PINNED_ENGINE}. `
        + 'A pass here is not a pass in production — that is the exact gap this file '
        + 'exists for. Use --service to ask the container itself.',
      );
    }
  }

  let failed = false;

  if (wantCapabilities) {
    const { dropped, engine, options } = await probe();
    console.log(`engine ${engine}${service ? ` (via ${service})` : ''}`);
    for (const [id, isDropped] of Object.entries(dropped)) {
      console.log(`  ${isDropped ? 'dropped ' : 'rendered'}  ${id}`);
    }
    if (options) {
      console.log(`  ${options.length} write_pdf options reported`);
    } else {
      console.warn(
        '! this route cannot report the engine\'s write_pdf options, so a renamed '
        + 'one is unchecked. Use --service to ask the container itself.',
      );
    }
    const result = reconcileCapabilities(dropped, options);
    if (capabilitiesAgree(result)) {
      console.log('\nengineSupport.pure.ts agrees with this engine.');
    } else {
      console.error(`\n${describeReconciliation(result)}`);
      failed = true;
    }
  }

  for (const input of inputs) {
    const file = resolve(input);
    if (!existsSync(file)) {
      console.error(`no such file: ${input}`);
      failed = true;
      continue;
    }
    const report = service
      ? await renderOnService(readFileSync(file, 'utf8'))
      : renderLocally(file, input.replace(/[^\w.-]/g, '_'));

    const detail = [
      report.pages === null ? null : `${report.pages} pages`,
      report.tagged === null ? null : report.tagged ? 'tagged' : 'UNTAGGED',
    ].filter(Boolean).join(', ');

    if (report.warnings.length === 0) {
      console.log(`ok  ${input} — the engine rendered it whole${detail ? ` (${detail})` : ''}`);
      continue;
    }
    failed = true;
    console.error(
      `\nFAIL ${input} — ${report.warnings.length} declaration(s) the engine did not apply:`,
    );
    for (const warning of report.warnings) console.error(`  ${warning}`);
    console.error(
      '\nEach line above is something the design intended and the page does not have. '
      + 'Nothing else reports these: the render succeeds either way.',
    );
  }

  return failed ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  },
);
