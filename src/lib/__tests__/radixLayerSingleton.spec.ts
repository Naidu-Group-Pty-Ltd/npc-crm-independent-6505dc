import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';

/**
 * Radix's DismissableLayer and FocusScope keep MODULE-LEVEL state — a stack
 * of open layers and the body's original `pointer-events` value. That only
 * works while every primitive in the app shares ONE copy of each module.
 *
 * It did not: `tldraw → radix-ui@1.5.0` pinned an older
 * `react-dismissable-layer` at the root of `node_modules`, so the app's own
 * Dialog, DropdownMenu, Popover, Select, Toast and Tooltip each received a
 * private NESTED copy of the version they require. The DropdownMenu disabled
 * outside pointer events on `<body>` through its instance; the Dialog opened
 * from that menu captured `"none"` as the body's "original" value through its
 * own instance — and restored `"none"` on close. Every dialog opened from a
 * menu anywhere in the product left the page unclickable until a reload. It
 * was found by asking the DOM after the editor closed, not by reading code.
 *
 * The fix is one resolution: the app's exact versions are direct dependencies,
 * so npm hoists them and dedupes every primitive onto them, while the older
 * pin nests under `radix-ui` where only tldraw reaches it. This test asserts
 * the resolution rather than the package.json line, because the line can be
 * present while a later `npm install` re-nests the copies.
 */
const ROOT = path.resolve(__dirname, '../../..');
const req = createRequire(path.join(ROOT, 'package.json'));

/**
 * The directory a package is installed in, found from its entry file.
 *
 * Radix packages export no `./package.json`, so `resolve('<pkg>/package.json')`
 * throws `ERR_PACKAGE_PATH_NOT_EXPORTED`; the entry file resolves, and the
 * package directory is the nearest `node_modules/<pkg>` segment above it.
 */
function packageDir(from: NodeJS.Require, pkg: string): string {
  const entry = from.resolve(pkg);
  const marker = `${path.sep}node_modules${path.sep}${pkg.split('/').join(path.sep)}${path.sep}`;
  const at = entry.lastIndexOf(marker);
  if (at < 0) throw new Error(`cannot locate ${pkg} from ${entry}`);
  return entry.slice(0, at + marker.length - 1);
}

/** The module a primitive actually loads for one of its internal packages. */
function resolvedFrom(primitive: string, internal: string): string {
  const local = createRequire(path.join(packageDir(req, primitive), 'package.json'));
  return local.resolve(internal);
}

const PRIMITIVES_ON_THE_JOURNEY = [
  '@radix-ui/react-dialog',
  '@radix-ui/react-alert-dialog',
  '@radix-ui/react-dropdown-menu',
  '@radix-ui/react-popover',
  '@radix-ui/react-select',
  '@radix-ui/react-toast',
  '@radix-ui/react-tooltip',
];

describe('Radix layer modules are singletons across the app’s primitives', () => {
  for (const internal of ['@radix-ui/react-dismissable-layer', '@radix-ui/react-focus-scope']) {
    it(`${internal} resolves to ONE file from every primitive`, () => {
      const resolved = new Map<string, string>();
      for (const primitive of PRIMITIVES_ON_THE_JOURNEY) {
        // A primitive that does not use the internal is simply skipped; the
        // menu family reaches DismissableLayer through @radix-ui/react-menu.
        let file: string;
        try { file = resolvedFrom(primitive, internal); } catch { continue; }
        resolved.set(primitive, file);
      }
      expect(resolved.size, 'the internal must be reachable from at least the Dialog and the menus').toBeGreaterThanOrEqual(3);
      const distinct = new Set(resolved.values());
      expect([...distinct], `${internal} is loaded from more than one place:\n${[...resolved].map(([p, f]) => `  ${p} → ${path.relative(ROOT, f)}`).join('\n')}`).toHaveLength(1);
      // And it is the ROOT copy, not a nested one.
      expect(path.relative(ROOT, [...distinct][0]).startsWith(`node_modules/${internal}/`)).toBe(true);
    });
  }

  it('the DropdownMenu family reaches DismissableLayer through the same root copy as the Dialog', () => {
    const menuReq = createRequire(path.join(packageDir(req, '@radix-ui/react-dropdown-menu'), 'package.json'));
    const reactMenuReq = createRequire(path.join(packageDir(menuReq, '@radix-ui/react-menu'), 'package.json'));
    const viaMenu = reactMenuReq.resolve('@radix-ui/react-dismissable-layer');
    const viaDialog = resolvedFrom('@radix-ui/react-dialog', '@radix-ui/react-dismissable-layer');
    expect(viaMenu).toBe(viaDialog);
  });
});
