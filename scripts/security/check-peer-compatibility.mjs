#!/usr/bin/env node
/**
 * A direct dependency may not require a React this project does not have.
 *
 * ## What went wrong
 *
 * Dependabot raised `react-leaflet` 4.2.1 → 5.0.0. It merged. `react-leaflet@5`
 * declares `peer react ^19.0.0`, and this project is pinned at `react ^18.3.1`,
 * so the tree stopped resolving:
 *
 *     npm error Could not resolve dependency:
 *     npm error peer react@"^19.0.0" from react-leaflet@5.0.0
 *
 * `npm ci` then fails on **every job of every pull request**, which is what it
 * did — `verify`, `security`, `supply-chain` and `render-container` all went red
 * together, none of them for a reason in the diff. The map would also have been
 * broken at runtime, which nothing would have reported until someone opened it.
 *
 * ## Why not a Dependabot ignore list
 *
 * `.github/dependabot.yml` already refuses majors for `react` and `react-dom`.
 * That does not help: the danger is not React moving, it is something moving
 * *past* React. **50 direct dependencies declare a React peer** — the whole
 * Radix set, TanStack, framer-motion, recharts, tldraw, sonner, cmdk. Listing
 * them by name is a list that is wrong the moment somebody adds the 51st.
 *
 * This asks the question instead of maintaining the answer.
 *
 * ## How
 *
 * Everything needed is already in `package-lock.json` — it records each
 * package's `peerDependencies` — so this needs no `node_modules` and runs in any
 * job. For every DIRECT dependency that names a `react` peer, the range must
 * admit the major this project pins.
 *
 * Deliberately narrow. It checks the one peer that has actually broken the
 * build, on direct dependencies only, and it compares MAJORS rather than
 * resolving semver properly — a transitive peer warning is npm's business, and a
 * general semver engine here would be a second resolver to keep correct.
 *
 * Run: node scripts/security/check-peer-compatibility.mjs
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// cwd, not import.meta.url — the negative-test harness mutates a mirror.
const root = resolve(process.cwd());

let pkg;
let lock;
try {
  pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
} catch (err) {
  // A lockfile that will not parse is its own emergency: `npm ci` refuses it
  // outright, so say that rather than a confusing peer message. This has
  // happened twice — a sync wrote a spliced file that npm rejected with
  // "can only install with an existing package-lock.json ... lockfileVersion >= 1",
  // which reads like the file is missing when it is merely unparseable.
  console.error(`Peer-compatibility check could not read package.json / package-lock.json: ${err.message}`);
  console.error('If the lockfile does not parse, `npm ci` fails on every job. Regenerate it:');
  console.error('  npm install --package-lock-only');
  process.exit(1);
}

/** `^18.3.1` -> 18. Ranges here are simple; see the header on why. */
const majorOf = (range) => {
  const m = String(range ?? '').match(/(\d+)/);
  return m ? Number(m[1]) : null;
};

/** Every major a peer range admits: `^16.8 || ^17.0 || ^18.0` -> [16,17,18]. */
const majorsAllowed = (range) =>
  [...String(range ?? '').matchAll(/(?:\^|~|>=|>|=)?\s*(\d+)/g)].map((m) => Number(m[1]));

const direct = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
const pinned = majorOf(direct.react);
if (pinned === null) {
  console.log('Peer-compatibility check skipped: this project does not depend on react.');
  process.exit(0);
}

const packages = lock.packages ?? {};
const failures = [];

for (const name of Object.keys(direct).sort()) {
  if (name === 'react') continue;
  const entry = packages[`node_modules/${name}`];
  const peer = entry?.peerDependencies?.react;
  if (!peer) continue;

  const allowed = majorsAllowed(peer);
  // `>=16` style ranges have no upper bound; anything at or below the pin is
  // satisfied. Only an explicit set that excludes the pin is a failure.
  const openEnded = /^\s*(>=|>)/.test(String(peer));
  if (openEnded ? allowed.every((m) => m > pinned) : !allowed.includes(pinned)) {
    failures.push(
      `${name}@${entry.version ?? direct[name]} requires \`react ${peer}\`, but this project pins `
      + `react ${direct.react}. \`npm ci\` cannot resolve that, so EVERY job fails — and the `
      + `component would be broken at runtime even if it could.`,
    );
  }
}

if (failures.length) {
  console.error('Peer-compatibility check FAILED:\n');
  for (const f of failures) console.error(`  - ${f}`);
  console.error(
    '\nEither pin the dependency back to a release that supports react '
    + `${pinned}, or upgrade React deliberately as its own change.`,
  );
  process.exit(1);
}

const checked = Object.keys(direct).filter(
  (n) => packages[`node_modules/${n}`]?.peerDependencies?.react,
).length;
console.log(
  `Peer-compatibility check passed (${checked} direct dependencies declare a react peer; `
  + `all admit react ${pinned}).`,
);
