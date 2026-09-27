/**
 * Each section is handed the registers its subject needs.
 *
 * 37 Bolin Street, 27 Sep 2026: the pin was 61,060 bytes and every section
 * logged `base 41964B (budget ~1800B, trimmed true)`, so the recorded-crime
 * block never reached the Environment section and it wrote that no local total
 * was held over a register that had answered for POA 2762.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import {
  pinForSection,
  pinGroup,
  SECTION_PIN_HOMES,
  stripPinTags,
} from '../../../../supabase/functions/_shared/reports/sectionPin.pure';
import { compassSections } from '../../../../supabase/functions/_shared/compassSectionRegistry';

const pin = [
  pinGroup('attributes', '# The property'), 'four bedrooms',
  pinGroup('planning', '# Zoning & Planning'), '| Zone | R2 |', 'PLANNING RULES',
  pinGroup('infrastructure', '# Infrastructure & Development Outlook'), '| Rouse Hill Hospital |',
  pinGroup('approvals', 'APPROVALS'),
  pinGroup('transport', '# Getting about'), 'St Albans Rd stop',
  pinGroup('market', '# Market Evidence'), '| Median | $1,100,000 |',
  pinGroup('environment', '# Environment'), 'Recorded offences in postcode 2762: **1,234**',
  pinGroup('rules', 'SUBJECT PRICE RULES'), 'CLAIM RULES',
].join('\n\n');

describe('what a section is handed', () => {
  it('the Environment section gets the crime and hazard evidence and the planning controls, and not the market', () => {
    const got = pinForSection(pin, 'compass.environmentSafety');
    expect(got).toContain('Recorded offences in postcode 2762');
    expect(got).toContain('| Zone | R2 |');
    expect(got).not.toContain('| Median |');
    expect(got).not.toContain('Rouse Hill Hospital');
  });

  it('names what it was not handed, and forbids stating or looking it up', () => {
    const got = pinForSection(pin, 'compass.transportAccess');
    expect(got).toContain('St Albans Rd stop');
    expect(got).toMatch(/Handed to other sections of this report, not to this one: .*the planning controls/);
    expect(got).toMatch(/do not look them up/);
  });

  it('every section keeps the attributes on record and the document rules', () => {
    for (const id of Object.keys(SECTION_PIN_HOMES)) {
      const got = pinForSection(pin, id);
      expect(got, id).toContain('four bedrooms');
      expect(got, id).toContain('CLAIM RULES');
      expect(got, id).not.toMatch(/\u001E/);
    }
  });

  it('the summary sections keep everything, including the environment', () => {
    for (const id of ['compass.executiveVerdict', 'compass.riskDashboard', 'compass.finalRecommendation']) {
      const got = pinForSection(pin, id);
      expect(got, id).toContain('Recorded offences');
      expect(got, id).toContain('Rouse Hill Hospital');
      expect(got, id).not.toMatch(/Handed to other sections/);
    }
  });

  it('a section the map does not name keeps exactly what it kept before', () => {
    const legacy = pinForSection(pin, 'financial.decisionSummary');
    expect(legacy).toContain('| Zone | R2 |');
    expect(legacy).toContain('| Median |');
    expect(legacy).not.toContain('Recorded offences');
    expect(legacy).not.toMatch(/Handed to other sections/);
    expect(pinForSection('no tags here', 'compass.planningConstraints')).toBe('no tags here');
    expect(stripPinTags(pin)).not.toMatch(/\u001E/);
  });

  it('every Compass section the generator writes has a home in the map', () => {
    for (const s of compassSections()) expect(SECTION_PIN_HOMES[s.id], s.id).toBeDefined();
  });

  it('the generator scopes the pin per section and pins the environment evidence', () => {
    const src = readFileSync('supabase/functions/generate-investment-report/index.ts', 'utf8');
    expect(src).toContain('pinForSection(pinnedContext, sectionDef.registryId)');
    expect(src).toContain("pinGroup('environment'");
    expect(src).not.toMatch(/request fresh web research for missing details/);
  });
});
