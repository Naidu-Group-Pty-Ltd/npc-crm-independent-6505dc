/**
 * No label in the frontend names the house on a clone.
 *
 * The owner's rule (26 Sep 2026): the house's identity is a legacy the prime
 * keeps and a clone never sees. The partner portals and several staff screens
 * were written for the prime, so on every clone a solicitor was offered a
 * "Direct line to the NPC team", a finance partner pinged an "NPC owner",
 * matters arrived "Flagged by NPC", and staff picked a report tier described
 * as carrying the "NPC view".
 *
 * Every such literal now reaches the page through `houseLabel(prime, clone)`,
 * which keeps the prime's words verbatim as its first argument. This file holds
 * the frontend to that from both sides:
 *
 *   - a literal naming the house is the FIRST argument of `houseLabel`, or it
 *     is recorded below with the reason it may stay — and a recorded reason
 *     that no longer matches anything fails, so the list cannot go stale;
 *   - a clone's words never name the house, the generic "Property Consulting"
 *     or Aurixa, and differ from the prime's;
 *   - both words are literals, so what each deployment reads can be read here
 *     rather than trusted, and nothing passes the deployment in by hand.
 *
 * It reads source, not a render: a clone's page is the prime's page with the
 * second argument chosen, so the arguments ARE what a clone is shown.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';

const deployment = vi.hoisted(() => ({ prime: true }));
vi.mock('../primeDeployment', () => ({ isPrimeDeployment: () => deployment.prime }));

import { houseLabel } from '../houseLabel';
import { isPrimeOnlyPath } from '../../../scripts/lib/primeOnlyFeatures.mjs';

const ROOT = resolve(__dirname, '../../..');
const SRC = join(ROOT, 'src');
const HELPER = 'src/lib/houseLabel.ts';

/** The house, however a literal spells it. */
const HOUSE = /\bNPC\b|Naidu|npcservices/;
/** What a clone's words may never say: the house, or a business the product has spoken as by default. */
const NEVER_ON_A_CLONE = /\bNPC\b|Naidu|npcservices|Property Consulting|Aurixa/i;

/**
 * Literals that name the house and stay, each with the reason. Keyed by the
 * literal's exact text so a NEW literal in one of these files is still caught.
 */
const RECORDED: ReadonlyArray<{ file: string; text: string; reason: string }> = [
  {
    file: 'src/lib/ciAssessment/intakePack/packPresentation.ts',
    text: 'Naidu Property Consulting Services',
    reason: "the name the approved intake pack files carry, which a clone's copy replaces; it is what is searched for, never what a clone is shown",
  },
  {
    file: 'src/lib/ciAssessment/intakePack/workbook.ts',
    text: 'NPC-CI-INTAKE-PACK',
    reason: 'a machine marker parseWorkbook reads back; renaming it would refuse every intake pack already issued',
  },
  {
    file: 'src/lib/integrations/registry.ts',
    text: 'NPC Verification Service (self-hosted)',
    reason: 'the AML/KYC integration card, which the owner keeps out of this work',
  },
  {
    file: 'src/lib/integrations/registry.ts',
    text: 'https://github.com/Naidu-Group-Pty-Ltd/npc-property-dashbord/blob/main/docs/aml/kyc-go-live-runbook.md',
    reason: 'the AML/KYC runbook link, which the owner keeps out of this work',
  },
  {
    file: 'src/lib/mcp/index.ts',
    text: 'NPC Command Centre MCP',
    reason: 'developer tooling bundled into the mcp edge function; no page renders it',
  },
  {
    file: 'src/lib/mcp/index.ts',
    text: 'MCP server for the NPC Command Centre app. Use `echo` to verify connectivity. Additional tools can be added under src/lib/mcp/tools/.',
    reason: 'developer tooling bundled into the mcp edge function; no page renders it',
  },
  {
    file: 'src/lib/reports/compassSectionRegistry.ts',
    text: 'NPC branding, report name ("Investment Location & Property Fit Report"), property address, report date.',
    reason: 'report registry content mirrored by the server registry; the owner asked for report content to be left alone',
  },
  {
    file: 'src/lib/reports/compassSectionRegistry.ts',
    text: 'NPC branding, "Financial Analysis Report", property address, report date.',
    reason: 'report registry content mirrored by the server registry; the owner asked for report content to be left alone',
  },
  {
    file: 'src/pages/portal/PortalIdentityReturn.tsx',
    text: 'NPC Identity Verification',
    reason: 'the identity-verification return page, an AML/KYC surface the owner keeps out of this work',
  },
  {
    file: 'src/pages/portal/PortalIdentityReturn.tsx',
    text: 'Your NPC session is still open in the window behind this one.',
    reason: 'the identity-verification return page, an AML/KYC surface the owner keeps out of this work',
  },
];

interface Literal {
  file: string;
  line: number;
  text: string;
}

interface Call {
  file: string;
  line: number;
  args: readonly ts.Expression[];
}

function shippedSources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === '__tests__' || name === 'node_modules') continue;
      shippedSources(path, out);
    } else if (/\.(tsx?|jsx?)$/.test(name) && !/\.(test|spec)\.|\.d\.ts$/.test(name)) {
      out.push(path);
    }
  }
  return out;
}

function isHouseLabelCall(node: ts.Node): node is ts.CallExpression {
  return ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'houseLabel';
}

function literalText(node: ts.Node, sf: ts.SourceFile): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) return node.getText(sf);
  if (ts.isJsxText(node)) return node.getText(sf).replace(/\s+/g, ' ').trim();
  return null;
}

/** Every literal naming the house, and every `houseLabel` call, across the shipped frontend. */
const scan = (() => {
  const unexplained: Literal[] = [];
  const recordedSeen = new Set<number>();
  const calls: Call[] = [];
  const importers = new Map<string, boolean>();

  for (const path of shippedSources(SRC)) {
    const file = relative(ROOT, path).split('\\').join('/');
    // What the prime keeps for itself (scripts/lib/primeOnlyFeatures.mjs) is
    // never carried to a clone, so nothing in it can name the house to one.
    // Its words are the house's own, on the one deployment that is the house.
    if (isPrimeOnlyPath(file)) continue;
    const text = readFileSync(path, 'utf8');
    if (!HOUSE.test(text) && !text.includes('houseLabel(')) continue;
    const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, /x$/.test(path) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const lineOf = (node: ts.Node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
          const named = node.importClause?.namedBindings;
          if (named && ts.isNamedImports(named) && named.elements.some((e) => e.name.text === 'houseLabel')) {
            importers.set(file, /(^|\/)houseLabel$/.test(node.moduleSpecifier.text));
          }
        }
        return;
      }
      if (isHouseLabelCall(node) && file !== HELPER) calls.push({ file, line: lineOf(node), args: node.arguments });

      const value = literalText(node, sf);
      if (value !== null && HOUSE.test(value)) {
        const parent = node.parent;
        const isPrimeWords = parent && isHouseLabelCall(parent) && parent.arguments[0] === node;
        if (!isPrimeWords) {
          const at = RECORDED.findIndex((r) => r.file === file && r.text === value);
          if (at >= 0) recordedSeen.add(at);
          else unexplained.push({ file, line: lineOf(node), text: value });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return { unexplained, recordedSeen, calls, importers };
})();

const staticText = (node: ts.Expression | undefined): string | null =>
  node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : null;

describe('houseLabel', () => {
  afterEach(() => {
    deployment.prime = true;
  });

  it('gives the prime its own words and a clone the clone’s', () => {
    expect(houseLabel('NPC Command Centre', 'Command Centre', true)).toBe('NPC Command Centre');
    expect(houseLabel('NPC Command Centre', 'Command Centre', false)).toBe('Command Centre');
  });

  it('asks which deployment this build talks to when it is not told', () => {
    deployment.prime = true;
    expect(houseLabel('NPC team', 'Command Centre team')).toBe('NPC team');
    deployment.prime = false;
    expect(houseLabel('NPC team', 'Command Centre team')).toBe('Command Centre team');
  });
});

describe('a literal that names the house reaches a clone only through houseLabel', () => {
  it('is the prime’s words in a houseLabel call, or recorded with its reason', () => {
    // Each offender is a label a clone reads as somebody else's business. Route
    // it through `houseLabel(prime, clone)`, or record why it may stay.
    expect(scan.unexplained.map((l) => `${l.file}:${l.line}  ${l.text}`)).toEqual([]);
  });

  it('keeps no recorded reason that matches nothing', () => {
    // A reason whose literal moved or went is a hole the next literal walks through.
    const stale = RECORDED.filter((_, i) => !scan.recordedSeen.has(i)).map((r) => `${r.file}  ${r.text}`);
    expect(stale).toEqual([]);
  });

  it('is actually in use, so a pass is not a pass over nothing', () => {
    // Measured when this was written: 38 sites across 23 files.
    expect(scan.calls.length).toBeGreaterThanOrEqual(30);
  });
});

describe('every houseLabel call says, in literals, what each deployment reads', () => {
  const described = scan.calls.map((c) => ({
    at: `${c.file}:${c.line}`,
    count: c.args.length,
    prime: staticText(c.args[0]),
    clone: staticText(c.args[1]),
  }));

  it('passes the prime’s words and the clone’s, and never the deployment', () => {
    // A third argument pins one answer for every deployment — `true` would put
    // the house back on every clone — so the build decides, never the call site.
    expect(described.filter((c) => c.count !== 2).map((c) => c.at)).toEqual([]);
    expect(described.filter((c) => c.prime === null || c.clone === null).map((c) => c.at)).toEqual([]);
  });

  it('wraps words that name the house', () => {
    expect(described.filter((c) => c.prime !== null && !HOUSE.test(c.prime)).map((c) => c.at)).toEqual([]);
  });

  it('never gives a clone the house, the generic firm or Aurixa', () => {
    const named = described.filter((c) => c.clone !== null && NEVER_ON_A_CLONE.test(c.clone));
    expect(named.map((c) => `${c.at}  ${c.clone}`)).toEqual([]);
  });

  it('gives a clone words of its own', () => {
    expect(described.filter((c) => c.clone !== null && c.clone === c.prime).map((c) => c.at)).toEqual([]);
    expect(described.filter((c) => c.clone !== null && c.clone.trim() === '').map((c) => c.at)).toEqual([]);
  });

  it('is the shared helper, never a local stand-in', () => {
    // A file-local `houseLabel = (p) => p` would satisfy every check above and
    // show the house everywhere.
    const callers = [...new Set(scan.calls.map((c) => c.file))];
    expect(callers.filter((f) => scan.importers.get(f) !== true)).toEqual([]);
  });
});

describe('the closed door on a clone', () => {
  it('names no business, since only a clone ever sees it', () => {
    // InternalToolingGuard renders its notice on a clone alone; it used to say
    // the page was "part of NPC Services' own operations".
    const guard = readFileSync(join(SRC, 'components/auth/InternalToolingGuard.tsx'), 'utf8');
    const notice = guard.slice(guard.indexOf('return ('));
    expect(notice).not.toMatch(NEVER_ON_A_CLONE);
  });
});
