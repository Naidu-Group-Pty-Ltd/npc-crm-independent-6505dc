/**
 * Which business the report writer is told it works for.
 *
 * The owner's rule (26 Sep 2026), raised as a commercial-readiness item: the
 * writer's persona was "still told which company it writes for, taken from
 * Report Settings", so a clone whose settings row still holds NPC's name had
 * its reports written by a model told it worked for NPC — and Market
 * Intelligence printed that name in the document ("How <company> Would Approach
 * This", its call to action).
 *
 * Held from both sides, as the rest of the white-label work is:
 *
 *   - on the prime every prompt reads exactly as it did (the name it was always
 *     given, nothing new read);
 *   - on a clone the writer works for the clone's own business, and never the
 *     house;
 *   - where a clone has named nobody the writer works for NO business, because
 *     the document is then issued under the platform, whose disclaimer says it
 *     prepared none of it.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  fillFirmToken,
  firmClause,
  indefiniteArticle,
  reportWriterIdentity,
  withoutFirmToken,
} from '../../../../supabase/functions/_shared/reports/writerFirm.pure';
import {
  PLATFORM_DISCLAIMER,
  PLATFORM_ISSUER_NAME,
} from '../../../../supabase/functions/_shared/reports/issuerIdentity.pure';

const PRIME = { prime: true } as const;
const CLONE = { prime: false } as const;
const HOUSE = 'Naidu Property Consulting Services';

const root = resolve(__dirname, '../../../..');
const source = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('who the writer works for', () => {
  it('on the prime, is the name the prime has always given it — placeholder included', () => {
    for (const name of [HOUSE, 'Property Consulting', 'Somebody Else Pty Ltd']) {
      const identity = reportWriterIdentity({ companyName: name }, PRIME);
      expect(identity.firm).toBe(name);
      expect(identity.issuerName).toBe(name);
      expect(identity.deployment).toBe(PRIME);
    }
  });

  it('on a clone, is the clone’s own business: Report Settings first, then the Branding page', () => {
    expect(reportWriterIdentity({ companyName: 'Acme Realty Pty Ltd', brandName: 'Acme' }, CLONE).firm)
      .toBe('Acme Realty Pty Ltd');
    expect(reportWriterIdentity({ companyName: 'Property Consulting', brandName: 'Acme Realty' }, CLONE).firm)
      .toBe('Acme Realty');
  });

  it('on a clone, is never the house, however a seeded row spells it', () => {
    for (const house of [HOUSE, 'NPC Services', 'NPC Services Melbourne', 'Naidu Property Consulting Services Pty Ltd']) {
      const identity = reportWriterIdentity({ companyName: house }, CLONE);
      expect(identity.firm).toBeNull();
      expect(identity.issuerName).toBe(PLATFORM_ISSUER_NAME);
      // A house row is passed over, and the Branding page's own name issues.
      expect(reportWriterIdentity({ companyName: house, brandName: 'Acme Realty' }, CLONE).firm).toBe('Acme Realty');
    }
  });

  it('on a clone that has named nobody, is no business at all — never the platform', () => {
    // The platform's own statement, printed on that same document, says it is
    // not an adviser and did not prepare the analysis. A persona "advisor at
    // Aurixa Systems" would have the prose say the opposite of the page.
    expect(PLATFORM_DISCLAIMER).toMatch(/has not been prepared by Aurixa Systems/);
    for (const input of [{}, { companyName: 'Property Consulting' }, { companyName: '', brandName: 'dashboard' }]) {
      const identity = reportWriterIdentity(input, CLONE);
      expect(identity.firm).toBeNull();
      expect(identity.issuerName).toBe(PLATFORM_ISSUER_NAME);
    }
  });
});

describe('a persona clause', () => {
  it('is exactly the clause the prime’s personas carried', () => {
    expect(`You are an expert Australian property investment analyst${firmClause(HOUSE, 'for')}.`)
      .toBe(`You are an expert Australian property investment analyst for ${HOUSE}.`);
    expect(`You are a trusted property investment advisor${firmClause(HOUSE, 'at')} writing`)
      .toBe(`You are a trusted property investment advisor at ${HOUSE} writing`);
  });

  it('is nothing where the writer works for no business', () => {
    expect(`You are an expert Australian property investment analyst${firmClause(null, 'for')}.`)
      .toBe('You are an expert Australian property investment analyst.');
  });

  it('takes the article its noun needs', () => {
    expect(indefiniteArticle('Market Intelligence Report')).toBe('a');
    expect(indefiniteArticle('Annual Review')).toBe('an');
  });
});

/**
 * Every built-in prompt template, read out of the catalogue's own source with
 * the TypeScript parser — so a template added later is held to the same rule
 * without anybody remembering to list it here.
 */
function catalogueTemplates(): { key: string; text: string }[] {
  const file = ts.createSourceFile(
    'engine-prompts.ts',
    source('supabase/functions/_shared/engine-prompts.ts'),
    ts.ScriptTarget.Latest,
    true,
  );
  const found: { key: string; text: string }[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isObjectLiteralExpression(node)) {
      const prop = (name: string) => node.properties.find(
        (p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && p.name.getText() === name,
      );
      const key = prop('key');
      const text = prop('default');
      if (key && text && (ts.isStringLiteral(text.initializer) || ts.isNoSubstitutionTemplateLiteral(text.initializer))) {
        found.push({ key: (key.initializer as ts.StringLiteral).text, text: text.initializer.text });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

describe('a prompt template for a writer that works for no business', () => {
  const templates = catalogueTemplates().filter((t) => t.text.includes('{{brand_name}}'));

  it('covers every template that names the firm', () => {
    // Eight when this was written: two Market Intelligence, the condense and
    // regenerate templates, and the four Investment system prompts.
    expect(templates.length).toBeGreaterThanOrEqual(8);
  });

  it.each(catalogueTemplates().filter((t) => t.text.includes('{{brand_name}}')).map((t) => [t.key, t.text]))(
    '%s names nobody and still reads',
    (_key, text) => {
      const firmless = withoutFirmToken(text);
      expect(firmless).not.toContain('{{brand_name}}');
      expect(firmless).not.toMatch(/Aurixa|Naidu|\bNPC\b/);
      // Nothing the rewrite takes out may leave a hole behind it.
      const holes = (s: string) => (s.match(/[^ \n] {2,}[^ ]|\s[.,;:](?=\s|$)/g) ?? []).length;
      expect(holes(firmless)).toBe(holes(text));
      expect(firmless).toMatch(/^You are |^[A-Z]/);
    },
  );

  it('reads the way each built-in template was written', () => {
    const byKey = new Map(templates.map((t) => [t.key, withoutFirmToken(t.text)]));
    expect(byKey.get('investment_report.system.default')).toMatch(
      /^You are a trusted property investment advisor writing a premium client-facing report\./,
    );
    expect(byKey.get('regenerate.qualitative_system')).toMatch(
      /^You are an expert Australian property investment analyst\. You produce/,
    );
    expect(byKey.get('condense.system_template')).toMatch(/^You are an expert investment property analyst\. Your task/);
    expect(byKey.get('market_intelligence.writer_system')).toMatch(
      /^You are a senior Australian property market analyst writing premium client reports\. Produce/,
    );
    // A sentence about the firm goes whole.
    const research = byKey.get('market_intelligence.perplexity_system') ?? '';
    expect(research).not.toMatch(/strategic property advisory/);
    expect(research).toMatch(/use specific numbers\. CRITICAL RULES:/);
  });

  it('fills a name exactly as the substitution always did', () => {
    for (const { text } of templates) {
      expect(fillFirmToken(text, HOUSE)).toBe(text.replace(/\{\{brand_name\}\}/g, HOUSE));
    }
  });

  it('names nobody in an override written some other way', () => {
    expect(withoutFirmToken('Write in the voice of {{brand_name}}.')).toBe('Write in the voice.');
    expect(withoutFirmToken("Match {{brand_name}}'s tone.")).toBe("Match the business's tone.");
    expect(withoutFirmToken('Prepared for an {{brand_name}} Annual Review.')).toBe('Prepared for an Annual Review.');
    expect(withoutFirmToken('Sign off as {{brand_name}}')).toBe('Sign off as the business providing this report');
  });

  it('is what the prompt resolver does with an explicit null, and only then', () => {
    const resolver = source('supabase/functions/_shared/engine-prompts.ts');
    expect(resolver).toMatch(/if \(tokens\.brand_name === null\) template = withoutFirmToken\(template\);/);
  });
});

describe('the writers', () => {
  const WRITERS = [
    'supabase/functions/generate-investment-report/index.ts',
    'supabase/functions/regenerate-report-qualitative/index.ts',
    'supabase/functions/condense-investment-report/index.ts',
    'supabase/functions/report-qa/index.ts',
    'supabase/functions/generate-market-intelligence-report/index.ts',
  ];

  it.each(WRITERS)('%s takes its persona from the writer identity, never Report Settings directly', (path) => {
    const text = source(path);
    expect(text).toContain('loadReportWriterIdentity');
    // A persona interpolating the settings row is the defect, however spelled.
    expect(text).not.toMatch(/\.companyName\}[^`\n]*(?:advis|analyst|strategist|writer)/i);
    expect(text).not.toMatch(/(?:analyst|advisor|advisory|strategist|writer)[^`\n]*\$\{[^}]*companyName\}/i);
  });

  it('Market Intelligence prints the firm only where it has one', () => {
    const lines = source('supabase/functions/generate-market-intelligence-report/index.ts').split('\n');
    lines.forEach((line, i) => {
      if (!line.includes('${BRAND_NAME}')) return;
      const context = lines.slice(Math.max(0, i - 2), i + 1).join('\n');
      expect(context, `line ${i + 1}: ${line.trim()}`).toContain('BRAND_NAME === null');
    });
  });

  it('the template AI author names NPC on the prime alone', () => {
    const text = source('supabase/functions/template-ai-author/index.ts');
    const mentions = text.split('\n').filter((l) => /NPC Property Services|an NPC report template/.test(l) && !l.trim().startsWith('*'));
    expect(mentions).toHaveLength(2);
    expect(mentions.join('\n')).toMatch(/if \(onPrime\(\)\) return 'NPC Property Services';/);
    expect(mentions.join('\n')).toMatch(/onPrime\(\) \? 'an NPC report template' : 'a report template'/);
  });

  it('the prime reads nothing it did not read before', () => {
    const loader = source('supabase/functions/_shared/reports/writerIdentity.ts');
    // The prime returns before the Branding page is asked for.
    const primeReturn = loader.indexOf('if (deployment.prime) return');
    const brandingRead = loader.indexOf('brandingPageName()');
    expect(primeReturn).toBeGreaterThan(0);
    expect(brandingRead).toBeGreaterThan(primeReturn);
  });
});
