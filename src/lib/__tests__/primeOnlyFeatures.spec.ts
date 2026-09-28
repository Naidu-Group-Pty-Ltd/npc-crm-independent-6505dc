/**
 * What the prime keeps for itself, held to the tree this runs in.
 *
 * `scripts/lib/primeOnlyFeatures.mjs` names the GoHighLevel account migration
 * as the prime's alone, and Aurixa Mission Control keeps its own copy of that
 * list: the cascade never writes the feature to a clone, provisioning never
 * deploys or schedules it, and parity never counts its absence. That leaves
 * two promises for this repository to keep, and a third for the prime alone.
 *
 * 1. NOTHING A CLONE RECEIVES IMPORTS THE FEATURE. A clone builds without the
 *    feature's files, so a static import of one breaks every clone's build
 *    the moment it is carried there, while the prime's own build, where the
 *    file is present, can never see it. `src/App.tsx` reaches the page through
 *    `import.meta.glob`, which answers an empty record for a missing file.
 * 2. NOTHING A CLONE RECEIVES INVOKES THE FEATURE'S FUNCTIONS BY NAME. No clone
 *    holds them, so an invocation there answers 404, and no build or type
 *    check can see that either.
 * 3. ON THE PRIME, THE REGISTER DESCRIBES SOMETHING REAL. Every file and
 *    function it names is here, every jobname glob matches a job the
 *    migrations schedule, and every bucket is one a migration creates. A
 *    register naming nothing is a hold with no subject, and a function gone
 *    missing on the prime would otherwise hide behind the exemption
 *    `check-cron-caller-names.mjs` grants a clone.
 *
 * The first two are held strictly on the prime, which is where new code is
 * written and where a mistake is carried from. On a clone they are held
 * against what the clone does NOT hold. A clone that has not yet shed the
 * feature still carries the prime's earlier `App.tsx` (the cascade leaves that
 * file for a person to reconcile), whose static import is harmless there, and
 * a spec that failed it would turn every cascade pull request red until
 * somebody did — the failure `testSupport/primeTree.ts` exists to stop.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, posix, relative, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import {
  PRIME_ONLY_FEATURES,
  functionDirectoryOf,
  isPrimeOnlyBucket,
  isPrimeOnlyCronJobName,
  isPrimeOnlyFunction,
  isPrimeOnlyPath,
  primeOnlyFileNames,
  primeOnlyFunctionNames,
} from '../../../scripts/lib/primeOnlyFeatures.mjs';
import { migrationText, migrationsContaining } from '../testSupport/migrationCorpus';
import { TREE_IS_PRIME } from '../testSupport/primeTree';

const ROOT = resolve(__dirname, '../../..');
const repoPath = (abs: string) => relative(ROOT, abs).split('\\').join('/');
const SELF = repoPath(__filename);
/** The register and its types list every name as data; they are not references. */
const REGISTER = new Set(['scripts/lib/primeOnlyFeatures.mjs', 'scripts/lib/primeOnlyFeatures.d.mts']);

const CODE = /\.(tsx?|jsx?|mjs|cjs|mts|cts)$/;
/** Where a reference into the feature would break a clone: what it builds, checks or runs. */
const IMPORT_ROOTS = ['src', 'supabase/functions', 'scripts', 'tests', 'tests-e2e'];
/** Where a function's name is an invocation a clone would answer 404 to: what it ships. */
const SHIPPED_ROOTS = ['src', 'supabase/functions'];

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (CODE.test(entry.name)) out.push(path);
  }
  return out;
}

/**
 * A file that cannot mention the feature cannot reach into it: a specifier
 * that names a registered file carries its basename, and one that names a
 * registered function carries its directory. Read only what might.
 */
const TOKENS = [
  ...[...primeOnlyFileNames()].map((f) => posix.basename(f).replace(/\.[^.]+$/, '')),
  ...primeOnlyFunctionNames(),
];
const mentionsFeature = (text: string) => TOKENS.some((token) => text.includes(token));

function parse(file: string, text: string): ts.SourceFile {
  const kind = /\.(tsx|jsx)$/.test(file)
    ? ts.ScriptKind.TSX
    : /\.(m|c)?js$/.test(file)
      ? ts.ScriptKind.JS
      : ts.ScriptKind.TS;
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
}

const literalText = (node: ts.Node | undefined): string | null =>
  node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : null;

/** `import.meta.glob(...)`, with or without type arguments (they sit on the call). */
const isImportMetaGlob = (callee: ts.Expression): boolean =>
  ts.isPropertyAccessExpression(callee) &&
  callee.name.text === 'glob' &&
  ts.isMetaProperty(callee.expression) &&
  callee.expression.keywordToken === ts.SyntaxKind.ImportKeyword;

interface Reference {
  /** A glob answers an empty record for a missing file; every other form fails without it. */
  kind: 'import' | 'glob';
  specifier: string;
  line: number;
}

/** Every module a file names: import, export-from, import(), require(), import type, import.meta.glob. */
function referencesIn(file: string, text: string): Reference[] {
  const sf = parse(file, text);
  const out: Reference[] = [];
  const lineOf = (node: ts.Node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const add = (kind: Reference['kind'], node: ts.Node | undefined, at: ts.Node) => {
    const specifier = literalText(node);
    if (specifier !== null) out.push({ kind, specifier, line: lineOf(at) });
  };
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      add('import', node.moduleSpecifier, node);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      add('import', node.moduleReference.expression, node);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      add('import', node.argument.literal, node);
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const [first] = node.arguments;
      if (callee.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(callee) && callee.text === 'require')) {
        add('import', first, node);
      } else if (isImportMetaGlob(callee)) {
        const patterns = first && ts.isArrayLiteralExpression(first) ? [...first.elements] : [first];
        for (const pattern of patterns) add('glob', pattern, node);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.d.ts', '.d.mts'];

/** The repository paths a specifier could name. Empty for a package, a URL or a registry specifier. */
function candidatesFor(file: string, specifier: string): string[] {
  const bare = specifier.split('?')[0];
  let base: string;
  if (bare.startsWith('./') || bare.startsWith('../')) base = posix.normalize(posix.join(posix.dirname(file), bare));
  else if (bare.startsWith('@/')) base = `src/${bare.slice(2)}`;
  else return [];
  const stems = [base, base.replace(/\.(m|c)?jsx?$/, '')];
  return [...new Set(stems.flatMap((stem) => [stem, ...EXTENSIONS.map((e) => stem + e), ...EXTENSIONS.map((e) => `${stem}/index${e}`)]))];
}

/**
 * What a specifier reaches in the feature: a registered file, or a registered
 * function's directory (written with its trailing slash), however many of the
 * specifier's candidate spellings land there.
 */
function reachedBy(file: string, specifier: string): string[] {
  const subjects = new Set<string>();
  for (const candidate of candidatesFor(file, specifier)) {
    if (primeOnlyFileNames().has(candidate)) subjects.add(candidate);
    else {
      const fn = functionDirectoryOf(candidate);
      if (fn !== null && isPrimeOnlyFunction(fn)) subjects.add(`supabase/functions/${fn}/`);
    }
  }
  return [...subjects];
}

/** Where a string names a prime-only function as something to call. */
function invokedFunctionsIn(file: string, text: string): Array<{ name: string; line: number }> {
  const sf = parse(file, text);
  const out: Array<{ name: string; line: number }> = [];
  const lineOf = (node: ts.Node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const judge = (value: string, at: ts.Node) => {
    if (isPrimeOnlyFunction(value)) out.push({ name: value.trim(), line: lineOf(at) });
    for (const m of value.matchAll(/functions\/v1\/([A-Za-z0-9_-]+)/g)) {
      if (isPrimeOnlyFunction(m[1])) out.push({ name: m[1], line: lineOf(at) });
    }
  };
  const visit = (node: ts.Node): void => {
    // A module specifier names a file, not a call: the import rule judges it.
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) return;
    const value = literalText(node);
    if (value !== null) judge(value, node);
    else if (ts.isTemplateExpression(node)) {
      judge(node.head.text, node);
      for (const span of node.templateSpans) judge(span.literal.text, node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

const heldHere = (path: string) => existsSync(join(ROOT, path));
const functionHeldHere = (name: string) => heldHere(`supabase/functions/${name}/index.ts`);
/** Whether this tree holds what `reachedBy` names. */
const subjectHeldHere = (subject: string) =>
  subject.endsWith('/') ? heldHere(`${subject}index.ts`) : heldHere(subject);

/**
 * Every source file under the import roots that is neither the feature, the
 * register nor this spec, and mentions the feature at all. Read once: the
 * roots hold some six thousand files.
 */
const OUTSIDE: ReadonlyArray<{ file: string; text: string }> = IMPORT_ROOTS
  .flatMap((root) => walk(join(ROOT, root)))
  .map((abs) => ({ file: repoPath(abs), abs }))
  .filter(({ file }) => file !== SELF && !REGISTER.has(file) && !isPrimeOnlyPath(file))
  .map(({ file, abs }) => ({ file, text: readFileSync(abs, 'utf8') }))
  .filter(({ text }) => mentionsFeature(text));

const outsideTheFeature = (roots: readonly string[]) =>
  OUTSIDE.filter(({ file }) => roots.some((root) => file.startsWith(`${root}/`)));

describe('the register', () => {
  const functions = PRIME_ONLY_FEATURES.flatMap((f) => [...f.functions]);
  const files = PRIME_ONLY_FEATURES.flatMap((f) => [...f.files]);

  it('names each feature once, and each feature holds something', () => {
    const keys = PRIME_ONLY_FEATURES.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const feature of PRIME_ONLY_FEATURES) {
      expect(feature.key).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(feature.title.trim()).not.toBe('');
      expect(feature.reason.trim()).not.toBe('');
      expect(feature.files.length + feature.functions.length).toBeGreaterThan(0);
    }
  });

  it('names each function and file once, as a repository path', () => {
    expect(new Set(functions).size).toBe(functions.length);
    expect(new Set(files).size).toBe(files.length);
    expect(functions.filter((fn) => !/^[a-z0-9][a-z0-9-]*$/.test(fn))).toEqual([]);
    expect(files.filter((f) => f.startsWith('/') || f.split('/').includes('..') || f.endsWith('/'))).toEqual([]);
  });

  /*
   * Mission Control withholds a function by its DIRECTORY. A file listed from
   * inside some other function's directory would hold back half a function,
   * and one listed from inside a registered function's directory is listed
   * twice.
   */
  it('withholds a function whole or not at all', () => {
    const inAFunction = files.filter((f) => functionDirectoryOf(f) !== null && functionDirectoryOf(f) !== '_shared');
    expect(inAFunction).toEqual([]);
  });

  it('matches by exact file and by function directory, and nothing wider', () => {
    for (const f of files) expect(isPrimeOnlyPath(f)).toBe(true);
    for (const fn of functions) {
      expect(isPrimeOnlyPath(`supabase/functions/${fn}/index.ts`)).toBe(true);
      // The directory itself is not a file in it.
      expect(isPrimeOnlyPath(`supabase/functions/${fn}`)).toBe(false);
    }
    // The ordinary GoHighLevel integration, and a name that merely shares a prefix.
    expect(isPrimeOnlyPath('supabase/functions/ghl-calendar/index.ts')).toBe(false);
    expect(isPrimeOnlyPath('supabase/functions/sync-ghl-conversations/index.ts')).toBe(false);
    expect(isPrimeOnlyPath('supabase/functions/_shared/ghl-account.ts')).toBe(false);
    expect(isPrimeOnlyPath('supabase/functions/migration-dispatcher-v2/index.ts')).toBe(false);
    expect(isPrimeOnlyFunction('migration-dispatcher-v2')).toBe(false);
  });

  it('matches a job by its name glob, and a bucket by its id', () => {
    expect(isPrimeOnlyCronJobName('migration-dispatcher-15s')).toBe(true);
    expect(isPrimeOnlyCronJobName('migration-dispatcher-5s')).toBe(true);
    expect(isPrimeOnlyCronJobName('sync-ghl-marketing-assets-6h')).toBe(false);
    expect(isPrimeOnlyCronJobName('')).toBe(false);
    expect(isPrimeOnlyBucket('ghl-marketing-dump')).toBe(true);
    expect(isPrimeOnlyBucket('listing-images')).toBe(false);
  });
});

describe('nothing a clone receives reaches into what the prime keeps', () => {
  /*
   * On the prime, every reference is refused. On a clone, only one to a file
   * the clone does not hold: that one fails its build or its checks.
   */
  it('imports none of the feature, except through import.meta.glob', () => {
    const offenders = outsideTheFeature(IMPORT_ROOTS).flatMap(({ file, text }) =>
      referencesIn(file, text)
        .filter((ref) => ref.kind === 'import')
        .flatMap((ref) => {
          const reached = reachedBy(file, ref.specifier);
          if (reached.length === 0) return [];
          if (!TREE_IS_PRIME && reached.every(subjectHeldHere)) return [];
          return [`${file}:${ref.line} imports ${ref.specifier}`];
        }),
    );
    expect(offenders).toEqual([]);
  });

  it("invokes none of the feature's functions by name", () => {
    const offenders = outsideTheFeature(SHIPPED_ROOTS).flatMap(({ file, text }) =>
      invokedFunctionsIn(file, text)
        .filter(({ name }) => TREE_IS_PRIME || !functionHeldHere(name))
        .map(({ name, line }) => `${file}:${line} invokes ${name}`),
    );
    expect(offenders).toEqual([]);
  });

  it('reaches the migration page through a glob, the one reference a tree without it survives', () => {
    const app = readFileSync(join(ROOT, 'src/App.tsx'), 'utf8');
    const globs = referencesIn('src/App.tsx', app).filter((ref) => ref.kind === 'glob');
    const toFeature = globs.filter((ref) => reachedBy('src/App.tsx', ref.specifier).length > 0);
    // On a clone still carrying the prime's earlier App.tsx there is no glob yet.
    if (TREE_IS_PRIME) expect(toFeature.map((ref) => ref.specifier)).toEqual(['./pages/admin/GhlMigration.tsx']);
  });
});

describe('the scanner sees what it is for', () => {
  const BEFORE = 'const GhlMigration = lazyWithRetry(() => import("./pages/admin/GhlMigration"));';
  const AFTER = "const page = import.meta.glob<{ default: () => ReactElement }>('./pages/admin/GhlMigration.tsx');";

  it("reads the static import App.tsx carried before this, and not the glob that replaced it", () => {
    const before = referencesIn('src/App.tsx', BEFORE);
    expect(before.map((r) => [r.kind, r.specifier])).toEqual([['import', './pages/admin/GhlMigration']]);
    expect(reachedBy('src/App.tsx', before[0].specifier)).toEqual(['src/pages/admin/GhlMigration.tsx']);

    const after = referencesIn('src/App.tsx', AFTER);
    expect(after.map((r) => [r.kind, r.specifier])).toEqual([['glob', './pages/admin/GhlMigration.tsx']]);
  });

  it('resolves an Edge Function import, an alias and a re-export', () => {
    const edge = referencesIn('supabase/functions/aml-cases/index.ts', "import { claimJob } from '../_shared/migration-jobs.ts';");
    expect(reachedBy('supabase/functions/aml-cases/index.ts', edge[0].specifier)).toEqual([
      'supabase/functions/_shared/migration-jobs.ts',
    ]);
    const alias = referencesIn('src/pages/Integrations.tsx', "export { default } from '@/components/admin/GhlMarketingRawDump';");
    expect(reachedBy('src/pages/Integrations.tsx', alias[0].specifier)).toEqual([
      'src/components/admin/GhlMarketingRawDump.tsx',
    ]);
    const into = referencesIn('supabase/functions/aml-cases/index.ts', "import x from '../migration-dispatcher/index.ts';");
    expect(reachedBy('supabase/functions/aml-cases/index.ts', into[0].specifier)).toEqual([
      'supabase/functions/migration-dispatcher/',
    ]);
    // A package, a URL and an ordinary shared module reach nothing.
    for (const spec of ['react', 'https://esm.sh/zod', 'npm:zod', '../_shared/ghl-account.ts']) {
      expect(reachedBy('supabase/functions/aml-cases/index.ts', spec)).toEqual([]);
    }
  });

  it('reads an invocation, and not a comment or an import that happens to name one', () => {
    const source = [
      '// migration-orchestrator used to be called from here',
      "await supabase.functions.invoke('migration-orchestrator', { body: {} });",
      'await fetch(`${base}/functions/v1/ghl-test-credentials`);',
      "import x from '../migration-dispatcher/index.ts';",
      "await supabase.functions.invoke('sync-ghl-conversations');",
    ].join('\n');
    expect(invokedFunctionsIn('src/lib/example.ts', source)).toEqual([
      { name: 'migration-orchestrator', line: 2 },
      { name: 'ghl-test-credentials', line: 3 },
    ]);
  });
});

/*
 * The register is the prime's statement of what it keeps. Read on a clone it
 * describes a tree the clone was never given, so these stand down there.
 */
describe.runIf(TREE_IS_PRIME)('on the prime, the register describes what is here', () => {
  /** The first read of the corpus loads every file's bytes: several seconds, once. */
  const CORPUS_READ_MS = 120_000;

  it('names only files the prime holds', () => {
    expect([...primeOnlyFileNames()].filter((f) => !heldHere(f))).toEqual([]);
  });

  it('names only functions the prime holds', () => {
    expect([...primeOnlyFunctionNames()].filter((fn) => !functionHeldHere(fn))).toEqual([]);
  });

  it('names only jobs the migrations schedule', () => {
    // Gated on bytes: the corpus is ~800 MB, nearly all of it template-library seed.
    const scheduled = new Set(
      migrationsContaining(['cron.schedule', 'CRON.SCHEDULE']).flatMap((name) =>
        [...migrationText(name).matchAll(/cron\.schedule\s*\(\s*'([^']+)'/gi)].map((m) => m[1]),
      ),
    );
    for (const feature of PRIME_ONLY_FEATURES) {
      for (const glob of feature.cronJobs) {
        const rx = new RegExp(`^${glob.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
        expect([...scheduled].some((name) => rx.test(name)), `${glob} matches no scheduled job`).toBe(true);
      }
    }
  }, CORPUS_READ_MS);

  it('names only buckets a migration creates', () => {
    for (const feature of PRIME_ONLY_FEATURES) {
      for (const bucket of feature.buckets) {
        const creating = migrationsContaining(['storage.buckets', 'STORAGE.BUCKETS'], `'${bucket}'`);
        expect(creating.length, `${bucket} is created by no migration`).toBeGreaterThan(0);
      }
    }
  }, CORPUS_READ_MS);
});
