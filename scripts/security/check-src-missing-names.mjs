#!/usr/bin/env node
/**
 * Undefined identifiers in the app bundle — fatal, never baselined.
 *
 * This is the browser-side twin of the TS2304/TS2552 rule
 * `check-edge-functions.mjs` already enforces over Edge Functions, and it
 * exists for the same reason, learned the same way.
 *
 * ## Why the build does not already catch this
 *
 * `npm run build` is Vite. Vite STRIPS types; it does not check them. A name
 * that does not exist is therefore not a build failure — it is a
 * successfully-bundled `ReferenceError` waiting for the line to run. The
 * repository has no `tsc` gate over `src/` at all: `tsconfig.json` declares
 * `"files": []` and delegates to project references, so `tsc --noEmit -p
 * tsconfig.json` (the obvious spelling) compiles NOTHING and exits 0 while
 * `tsconfig.app.json` holds the real error.
 *
 * ## Why this class and no other
 *
 * `src/` carries pre-existing type errors — 17 of them the day this gate was
 * written — and none is worth blocking a release over: a wrong `LegacyRef`
 * variance renders exactly the same pixels. An undefined identifier is a
 * different kind of thing. It is not a mistyped contract, it is a line that
 * cannot execute, and the component containing it throws on render.
 *
 * ## Why it is here
 *
 * It happened twice, in two different spellings of the same fault.
 *
 * The second time was `TS2448`, 13 Sep 2026. A `useEffect` dependency array
 * named `correspondence` forty lines ABOVE the `const` that declared it. A
 * dependency array is an ordinary expression evaluated during render, so the
 * binding was read inside its temporal dead zone and both conversation
 * surfaces threw `ReferenceError: Cannot access 'correspondence' before
 * initialization` on every render, for every user, with no input that avoided
 * it. This gate ran on that commit and printed "No undefined identifiers in
 * src/." — because it filtered on a two-entry map and TS2448 was not in it.
 *
 * The lesson is not "add a code". It is that the class this gate defends is
 * **a name that cannot be read at the moment the line runs**, and TypeScript
 * spells that three ways: the name does not exist (TS2304/TS2552), or it
 * exists but is not reachable yet (TS2448). All three are a ReferenceError
 * with the component's whole page behind it, and none is type debt. A code
 * that produces a certain ReferenceError belongs here; one that describes a
 * wrong shape does not, which is why TS2454 (used before ASSIGNED) is
 * deliberately absent — that is definite-assignment analysis, it is routinely
 * conservative, and it does not promise a throw.
 *
 * The first time. `PortalAgreementConsent` declared `beforeAccept` in its props
 * TYPE and rendered `{beforeAccept}` in its JSX, and the prop was never added
 * to the destructured parameter list. TypeScript was right about the props;
 * the identifier simply did not exist. Lint passed, the build passed, and
 * every guard over that surface reads source rather than mounting it — so the
 * first thing that noticed was a partner outside every portal, opening an
 * emailed compliance agreement and being shown "Something went wrong" by the
 * top-level error boundary, with no account, no support channel and no way to
 * tell a broken page from a bad link.
 *
 * ## The ratchet
 *
 * `src-missing-names.txt` freezes occurrences that already existed, keyed by
 * FILE and IDENTIFIER rather than by line — a line number moves with every
 * edit above it, so a positional key would either churn or silently start
 * covering a different defect. It is EMPTY at the time of writing, which is
 * the whole point: there is no debt to grandfather, so nothing new may land.
 *
 *   node scripts/security/check-src-missing-names.mjs
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const KNOWN_MISSING_PATH = join(root, 'scripts', 'security', 'src-missing-names.txt');

/**
 * There is no such thing as a deliberately-undefined identifier on a live code
 * path, nor a deliberate read of a binding before it exists. TS2552 is TS2304
 * with a spelling suggestion attached; TS2448 is the same outcome reached by
 * ORDER rather than by absence — the name is declared, just not yet, and the
 * read throws exactly as hard.
 *
 * This list grows only for a code that guarantees a ReferenceError at the
 * moment the line runs. It is not a place to collect type errors.
 */
const FATAL = new Map([
  ['TS2304', 'name does not exist — ReferenceError the moment that line renders'],
  ['TS2552', 'name does not exist — ReferenceError the moment that line renders'],
  ['TS2448', 'name read before its declaration — ReferenceError the moment that line renders'],
]);

const KNOWN_MISSING = new Set(readFileSync(KNOWN_MISSING_PATH, 'utf8')
  .split('\n').map((line) => line.replace(/#.*$/, '').trim()).filter(Boolean));

/*
 * `tsc` exits non-zero whenever it reports anything, and `src/` has
 * pre-existing errors this gate deliberately ignores — so a non-zero exit is
 * expected and the OUTPUT is what is read. A tsc that produced no output at
 * all while failing is a different problem (a bad project file, a missing
 * dependency) and is reported as one rather than passing silently.
 */
/*
 * `tsc` over this project peaks at ~3.2 GB, measured. Node's default old-space
 * ceiling is smaller than that on a GitHub runner, so the child died with
 * "Ineffective mark-compacts near heap limit" after 93 seconds and this gate
 * reported, correctly, that it "did not run". Every pull request in the
 * repository failed `verify` on it.
 *
 * The honest failure is what made it findable — a gate that cannot run must
 * never report a pass — so that branch below is untouched and only the heap
 * moves. 6 GB against a measured 3.2 GB peak leaves room for the project to
 * grow before this is a question again; the runner has 16 GB.
 *
 * An existing NODE_OPTIONS is preserved rather than replaced: it may carry
 * something the caller needs, and appending keeps the last --max-old-space-size
 * winning if one is already set.
 */
const TSC_HEAP_MB = 6144;
const childEnv = {
  ...process.env,
  NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --max-old-space-size=${TSC_HEAP_MB}`.trim(),
};

let out = '';
try {
  out = execFileSync('npx', ['tsc', '--noEmit', '-p', 'tsconfig.app.json'], {
    cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024,
    env: childEnv,
  });
} catch (error) {
  out = `${error.stdout ?? ''}${error.stderr ?? ''}`;
  if (!/error TS\d+/.test(out)) {
    console.error('Could not type-check tsconfig.app.json — this gate did not run:\n');
    console.error(out.trim() || String(error));
    process.exit(1);
  }
}

/** `src/path/File.tsx(155,10): error TS2304: Cannot find name 'x'.` */
const LINE = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.+)$/;
const fatal = [];
for (const line of out.split('\n')) {
  const match = LINE.exec(line.trim());
  if (!match) continue;
  const [, rawFile, row, col, code, message] = match;
  if (!FATAL.has(code)) continue;
  const file = relative(root, resolve(root, rawFile)).replace(/\\/g, '/');
  const name = message.match(/Cannot find name '([^']+)'/)?.[1] ?? null;
  if (name && KNOWN_MISSING.has(`${file}::${name}`)) continue;
  fatal.push({ code, where: `${file}:${row}:${col}`, message });
}

if (fatal.length > 0) {
  console.error(
    `\n${fatal.length} unreadable identifier(s) in src/. These are never type debt and are\n`
    + 'never baselined: the name cannot be read where it is used — it does not exist, or it is\n'
    + 'not declared yet — so the line throws a ReferenceError the moment it renders, and a\n'
    + 'component that throws on render takes its whole page with it.\n',
  );
  for (const item of fatal) {
    console.error(`  ${item.where}\n    ${item.code}: ${item.message}\n    ${FATAL.get(item.code)}`);
  }
  console.error(
    '\nFor TS2304/TS2552, fix the name; if it is a real global this project\'s types do not know\n'
    + 'about, declare it in global.d.ts. For TS2448, MOVE THE DECLARATION above its first\n'
    + 'reader — note that a hook dependency array is an ordinary expression evaluated during\n'
    + 'render, so naming a `const` there that is declared further down is exactly this fault.\n'
    + `Adding it to ${relative(root, KNOWN_MISSING_PATH)} is for occurrences that predate\n`
    + 'this gate, and there were none.\n',
  );
  process.exit(1);
}

console.log('No undefined identifiers in src/.');
