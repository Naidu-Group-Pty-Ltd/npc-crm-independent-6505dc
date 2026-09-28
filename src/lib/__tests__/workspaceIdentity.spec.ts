/**
 * Which business a deployment's own tools speak for.
 *
 * The owner's commercial-readiness item (26 Sep 2026): after the report
 * writers were moved onto the deployment's identity, the email copilot, the
 * dashboard assistant and the user guide still took the company name from
 * Report Settings, and Market Updates Q&A named NPC as a literal on every
 * deployment. A sweep for the same fault found the finance portal copilot,
 * the solicitor portal's closed-matter refusal, the Command Centre's message
 * signature and thread label, a finance partner's ping, the conversation
 * export's author and the authenticator issuer.
 *
 * Held from both sides, as the rest of the white-label work is:
 *
 *   - on the prime every site says exactly what it said, and a site that
 *     printed a literal reads nothing to keep saying it;
 *   - on a clone the business is the clone's own, and never the house;
 *   - where a clone names nobody, nobody is named — not NPC, not the generic
 *     "Property Consulting", and not Aurixa.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  authenticatorIssuer,
  closedMatterMessage,
  commandCentreSender,
  copilotOutboundEmails,
  copilotSignOff,
  copilotToneOwner,
  exportAuthor,
  firmDescribed,
  firmModifier,
  firmPhrase,
  marketAnalystOpening,
  partnerPingHeading,
  possessive,
  purchaseFileSummaryTone,
  resolveWorkspaceIdentity,
  type WorkspaceIdentity,
} from '../../../supabase/functions/_shared/workspaceIdentity.pure';

const PRIME = { prime: true } as const;
const CLONE = { prime: false } as const;
const HOUSE = 'Naidu Property Consulting Services';

const root = resolve(__dirname, '../../..');
const source = (path: string) => readFileSync(resolve(root, path), 'utf8');

const named = (firm: string): WorkspaceIdentity => ({ deployment: CLONE, firm });
const unnamed: WorkspaceIdentity = { deployment: CLONE, firm: null };
/** A prime site that printed a literal reads nothing, so its identity names nobody. */
const primeLiteral: WorkspaceIdentity = { deployment: PRIME, firm: null };

describe('who the tools speak for', () => {
  it('on the prime, is Report Settings’ name exactly as read — placeholder included — and nothing else', () => {
    for (const name of [HOUSE, 'Property Consulting', 'Somebody Else Pty Ltd']) {
      const identity = resolveWorkspaceIdentity(
        { companyName: name, brandName: 'Ignored Brand', workspaceName: 'Ignored Workspace' },
        PRIME,
      );
      expect(identity).toEqual({ deployment: PRIME, firm: name });
    }
    // A prime site that never read a name is given none.
    expect(resolveWorkspaceIdentity({}, PRIME).firm).toBeNull();
  });

  it('on a clone, is its own business: Report Settings, then the Branding page, then the provisioned name', () => {
    expect(resolveWorkspaceIdentity({ companyName: 'Acme Realty Pty Ltd', brandName: 'Acme', workspaceName: 'Acme WS' }, CLONE).firm)
      .toBe('Acme Realty Pty Ltd');
    expect(resolveWorkspaceIdentity({ companyName: 'Property Consulting', brandName: 'Acme Realty', workspaceName: 'Acme WS' }, CLONE).firm)
      .toBe('Acme Realty');
    expect(resolveWorkspaceIdentity({ companyName: 'Property Consulting', brandName: '', workspaceName: 'Preflight Property Group' }, CLONE).firm)
      .toBe('Preflight Property Group');
  });

  it('on a clone, never the house — whichever row holds it, however it is written', () => {
    for (const house of [HOUSE, 'NPC Services', 'NPC Services Pty Ltd', 'Naidu Property Consulting', 'NPC Services Melbourne', '  naidu   property consulting SERVICES ']) {
      expect(resolveWorkspaceIdentity({ companyName: house }, CLONE).firm).toBeNull();
      expect(resolveWorkspaceIdentity({ brandName: house }, CLONE).firm).toBeNull();
      expect(resolveWorkspaceIdentity({ workspaceName: house }, CLONE).firm).toBeNull();
      expect(resolveWorkspaceIdentity({ companyName: house, brandName: house, workspaceName: 'Acme' }, CLONE).firm).toBe('Acme');
    }
  });

  it('a placeholder is not a name, and a stranger sharing the initials is not the house', () => {
    for (const placeholder of ['', '   ', 'Property Consulting', 'property  consulting', 'NPC', 'NPC Property', 'dashboard', undefined, null, 42]) {
      expect(resolveWorkspaceIdentity({ companyName: placeholder }, CLONE).firm).toBeNull();
    }
    // Two real clones were provisioned under names that start with NPC.
    expect(resolveWorkspaceIdentity({ workspaceName: 'NPC Test' }, CLONE).firm).toBe('NPC Test');
    expect(resolveWorkspaceIdentity({ workspaceName: 'NPC CRM Independent' }, CLONE).firm).toBe('NPC CRM Independent');
    expect(resolveWorkspaceIdentity({ companyName: 'NPC Realty' }, CLONE).firm).toBe('NPC Realty');
  });

  it('folds whitespace a settings row can carry into a prompt or a header', () => {
    expect(resolveWorkspaceIdentity({ companyName: '  Acme\n  Realty\t' }, CLONE).firm).toBe('Acme Realty');
  });

  it('where a clone names nobody, names nobody — never NPC, the placeholder or Aurixa', () => {
    expect(resolveWorkspaceIdentity({ companyName: 'Property Consulting', brandName: null, workspaceName: undefined }, CLONE))
      .toEqual({ deployment: CLONE, firm: null });
  });
});

describe('each phrase reads whole with a name and without one', () => {
  it('describes, attaches and modifies', () => {
    expect(firmDescribed('Acme', 'a property investment advisory')).toBe('Acme, a property investment advisory');
    expect(firmDescribed(null, 'a property investment advisory')).toBe('a property investment advisory');
    expect(firmPhrase('Acme', 'used by')).toBe(' used by Acme');
    expect(firmPhrase(null, 'used by')).toBe('');
    expect(firmModifier('Acme')).toBe('Acme ');
    expect(firmModifier(null)).toBe('');
    expect(possessive('Acme Realty')).toBe("Acme Realty's");
    expect(possessive('Acme Services')).toBe("Acme Services'");
  });

  it('the copilot keeps the prime’s own spelling and gives a clone proper grammar', () => {
    const prime: WorkspaceIdentity = { deployment: PRIME, firm: HOUSE };
    expect(copilotToneOwner(prime)).toBe(`${HOUSE}'`);
    expect(copilotOutboundEmails(prime)).toBe(`${HOUSE}'s outbound emails`);
    // The prime's spelling is kept whatever its Report Settings hold, which a
    // name ending in "s" cannot show: a correct possessive spells it the same.
    expect(copilotToneOwner({ deployment: PRIME, firm: 'Acme Realty' })).toBe("Acme Realty'");
    expect(copilotOutboundEmails({ deployment: PRIME, firm: 'Acme Services' })).toBe("Acme Services's outbound emails");
    expect(copilotToneOwner(named('Acme Realty'))).toBe("Acme Realty's");
    expect(copilotOutboundEmails(named('Acme Realty'))).toBe("Acme Realty's outbound emails");
    expect(copilotToneOwner(unnamed)).toBe("the business's");
    expect(copilotOutboundEmails(unnamed)).toBe('outbound emails');
    expect(copilotSignOff(HOUSE)).toBe(`Sign off as "${HOUSE} Team"`);
    expect(copilotSignOff(null)).toMatch(/do not invent a company or team name/);
  });
});

describe('a site that printed a literal keeps it on the prime, and names the clone on a clone', () => {
  const sites: Array<[string, (identity: WorkspaceIdentity) => string | null, string]> = [
    ['Market Updates Q&A', (i) => marketAnalystOpening(i, 'extracting structured evidence.'),
      'You are the NPC Australian property-market intelligence analyst extracting structured evidence.'],
    ['finance portal copilot', purchaseFileSummaryTone, 'Tone: factual, actionable, NPC-branded (no AI emojis or filler).'],
    ['closed matter', closedMatterMessage, 'This matter is closed. Contact NPC to reopen it.'],
    ['Command Centre sender', commandCentreSender, 'NPC Command Centre'],
    ['partner ping', (i) => partnerPingHeading(i, 'abcd1234'), '[NPC ping — PF abcd1234]'],
    ['export author', exportAuthor, 'NPC Services'],
    ['authenticator issuer', authenticatorIssuer, 'NPC Property Dashboard'],
  ];

  for (const [name, speak, primeLiteral_] of sites) {
    it(`${name}: the prime’s literal, whatever the identity holds`, () => {
      expect(speak(primeLiteral)).toBe(primeLiteral_);
      expect(speak({ deployment: PRIME, firm: 'Anything At All' })).toBe(primeLiteral_);
    });

    it(`${name}: a clone’s own name, or none — never the house, the placeholder or the platform`, () => {
      const withName = speak(named('Acme Realty'));
      const without = speak(unnamed);
      for (const said of [withName, without]) {
        if (said === null) continue;
        expect(said).not.toMatch(/\bNPC\b|Naidu|npcservices/);
        expect(said).not.toMatch(/Property Consulting|Aurixa/);
        expect(said).not.toMatch(/\s{2,}|\(\s|\s[,.]|^\s|\s$/);
      }
      expect(withName).toContain('Acme Realty');
    });
  }

  it('the export names no author at all where the clone names nobody', () => {
    expect(exportAuthor(unnamed)).toBeNull();
  });
});

// ── The functions themselves ───────────────────────────────────────────────

const FUNCTIONS = 'supabase/functions';

const ASSISTANTS = ['email-copilot', 'ai-dashboard-agent', 'user-guide-assistant'];
const LITERAL_SITES: Array<[string, RegExp, string]> = [
  ['market-updates-qa', /the NPC Australian/, 'marketAnalystOpening('],
  ['finance-portal-ai-copilot', /NPC-branded/, 'purchaseFileSummaryTone('],
  ['solicitor-portal-intelligence', /Contact NPC/, 'closedMatterMessage('],
  ['legal-matters-admin', /'NPC Command Centre'/, 'commandCentreSender('],
  ['finance-portal-batch9-10', /\[NPC ping/, 'partnerPingHeading('],
  ['build-conversations-export-worker', /<dc:creator>NPC Services/, 'exportAuthor('],
  ['security-step-up', /'NPC Property Dashboard'/, 'authenticatorIssuer('],
];

/** Every string and template literal in a file, as written. */
function literalsOf(path: string): string[] {
  const sf = ts.createSourceFile(path, source(path), ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateExpression(n)) out.push(n.getText(sf));
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

describe('every site asks the one rule', () => {
  it('the assistants no longer take the business from Report Settings themselves', () => {
    for (const fn of ASSISTANTS) {
      const text = source(`${FUNCTIONS}/${fn}/index.ts`);
      expect(text, fn).not.toMatch(/getBrandConfig|companyName/);
      expect(text, fn).toMatch(/loadWorkspaceIdentity\(\{ readPrimeName: true \}\)/);
    }
  });

  it('each literal site speaks through its phrase, and reads nothing on the prime', () => {
    for (const [fn, old, phrase] of LITERAL_SITES) {
      const text = source(`${FUNCTIONS}/${fn}/index.ts`);
      expect(text, fn).not.toMatch(old);
      expect(text, fn).toContain(phrase);
      expect(text, fn).toMatch(/loadWorkspaceIdentity\(\{ readPrimeName: false \}\)/);
      expect(text, fn).not.toMatch(/loadWorkspaceIdentity\(\{ readPrimeName: true \}\)/);
    }
  });

  it('the loader returns on the prime before it reads a thing a literal site never read', () => {
    const loader = source(`${FUNCTIONS}/_shared/workspaceIdentity.ts`);
    const body = loader.slice(loader.indexOf('export async function loadWorkspaceIdentity'));
    const primeReturn = body.indexOf('if (!options.readPrimeName) return resolveWorkspaceIdentity({}, deployment);');
    expect(primeReturn).toBeGreaterThan(0);
    for (const read of ['getBrandConfig()', 'brandingPageName()', "MISSION_CONTROL_AGENCY_NAME"]) {
      expect(body.indexOf(read), read).toBeGreaterThan(primeReturn);
    }
    // On the prime an assistant reads Report Settings, as it always did, and
    // nothing a clone reads.
    const primeBlock = body.slice(body.indexOf('if (deployment.prime) {'), body.indexOf('\n  }\n'));
    expect(primeBlock.match(/getBrandConfig\(\)/g)).toHaveLength(1);
    expect(primeBlock).not.toMatch(/brandingPageName|MISSION_CONTROL_AGENCY_NAME|Deno\.env|env\(/);
  });

  it('no persona in any function names the house', () => {
    // The persona is the sentence that says who the model is. A prompt may
    // still name the house elsewhere where the prime alone is shown it.
    const offenders: string[] = [];
    const dirs = readdirNames(resolve(root, FUNCTIONS)).filter((d) => !d.startsWith('_'));
    for (const dir of dirs) {
      const path = `${FUNCTIONS}/${dir}/index.ts`;
      let literals: string[];
      try { literals = literalsOf(path); } catch { continue; }
      for (const lit of literals) {
        for (const persona of lit.match(/You are\b[^.!?\n]*/g) ?? []) {
          if (/\bNPC\b|Naidu/.test(persona)) offenders.push(`${dir}: ${persona.slice(0, 90)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('a clone’s model is never shown the house in a worked example or a prohibition', () => {
    const ads = source(`${FUNCTIONS}/analyze-meta-ads-phase2/index.ts`);
    expect(ads).toContain('Shift 100% of daily budget into the "${exampleAdSet}" set');
    expect(ads).toMatch(/\.deployment\.prime\s*\?\s*'NPC – Property Strategy'\s*:\s*'Property Strategy'/);
    const report = source(`${FUNCTIONS}/generate-investment-report/index.ts`);
    expect(report).toContain(`or \${_writerSys.deployment.prime ? '"NPC view"' : '"Our view"'}, as a heading`);
    // "Our view" is a label the generator already strips, so the clone's
    // prohibition names one the document can never carry.
    expect(report).toMatch(/NPC\\s\+\(\?:View\|Take\)\|Our\\s\+View/);
  });

  it('the legacy Investment route carries no "NPC view" label, reachable or not', () => {
    expect(source(`${FUNCTIONS}/render-investment-report-pdf/index.ts`)).not.toMatch(/NPC view/);
  });

  it('a Command Centre thread is labelled with the name its messages are signed with', () => {
    const admin = source(`${FUNCTIONS}/legal-matters-admin/index.ts`);
    expect(admin).toContain('scopeLabel(scope, await commandCentreName())');
    expect(admin).toContain('String(body.sender_name || await commandCentreName())');
  });
});

function readdirNames(dir: string): string[] {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { readdirSync, statSync } = require('node:fs') as typeof import('node:fs');
  return readdirSync(dir).filter((name) => statSync(resolve(dir, name)).isDirectory());
}
