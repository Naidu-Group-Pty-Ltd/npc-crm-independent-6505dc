/**
 * "Use template" with a colourway.
 *
 * The working copy is the point where a preview becomes a thing a customer's
 * report will be rendered from, so the rules here are the security-relevant
 * ones: what the client may influence, what the server decides, and what a
 * rejected request does.
 *
 * The existing guarantees — that a copy is never live, never owned by anyone
 * but its maker, and never able to name its own `scope` or `is_active` — are
 * covered by `reportTemplateInsertGuard.spec.ts` and are re-asserted here
 * against the colourway path, because a new argument to
 * `buildWorkingCopyPayload` is exactly how a payload rule gets quietly lost.
 */
import { describe, it, expect } from 'vitest';
import {
  buildWorkingCopyPayload,
  familyKeyOf,
  offeredColourwayIds,
  resolveRequestedColourway,
} from '../../../../supabase/functions/_shared/templateLibraryCore.pure';
import {
  PRIVATE_BANKING_COLOURWAYS, colourwayColors, findColourway,
} from '../colourways';
import { INVESTMENT_COMPASS_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/templates';

const CHANCERY = INVESTMENT_COMPASS_TEMPLATES[0];

/** A published library row as the edge function would have loaded it. */
function entry(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'entry-1',
    slug: CHANCERY.slug,
    version: 1,
    name: CHANCERY.name,
    description: CHANCERY.description,
    report_type: CHANCERY.reportType,
    tier: 'compass',
    variant: null,
    engine: 'weasyprint',
    config: {},
    custom_css: null,
    schema: CHANCERY.schema,
    design_meta: CHANCERY.designMeta,
    ...over,
  };
}

/** A voice-catalogue row: no design family, no colourways. */
function voiceEntry(): Record<string, unknown> {
  return entry({ id: 'entry-voice', design_meta: {} });
}

describe('reading a family entry', () => {
  it('finds the family key', () => {
    expect(familyKeyOf(entry())).toBe('private_banking');
  });

  it('reports no family for a voice entry', () => {
    expect(familyKeyOf(voiceEntry())).toBeNull();
    expect(familyKeyOf({})).toBeNull();
  });

  it('lists the ten offered colourways in the approved order', () => {
    expect(offeredColourwayIds(entry())).toEqual(PRIVATE_BANKING_COLOURWAYS.map((c) => c.id));
  });
});

describe('resolving the requested colourway', () => {
  it('falls back to the family default when none is asked for', () => {
    const { colourway, problem } = resolveRequestedColourway(entry(), undefined);
    expect(problem).toBeNull();
    expect(colourway?.id).toBe('pb-gold-on-obsidian');
  });

  it('accepts a colourway the entry offers', () => {
    const { colourway, problem } = resolveRequestedColourway(entry(), 'pb-midnight-navy');
    expect(problem).toBeNull();
    expect(colourway?.name).toBe('Midnight Navy');
  });

  it('rejects an id the entry does not offer rather than falling back', () => {
    // Silently substituting the default is the failure mode this exists to
    // prevent: a user who chose Oxblood Night and received Gold on Obsidian
    // only finds out after opening the copy in the Builder.
    const { colourway, problem } = resolveRequestedColourway(entry(), 'pb-not-real');
    expect(colourway).toBeNull();
    expect(problem?.code).toBe('colourway_not_offered');
  });

  it('rejects a colourway curated by a different family', () => {
    const restricted = entry({
      design_meta: { ...CHANCERY.designMeta, colourways: ['pb-gold-on-obsidian', 'pb-verde'] },
    });
    const { colourway, problem } = resolveRequestedColourway(restricted, 'pb-midnight-navy');
    expect(colourway).toBeNull();
    expect(problem?.code).toBe('colourway_not_offered');
  });

  it('rejects a colourway request against an entry with no family', () => {
    const { colourway, problem } = resolveRequestedColourway(voiceEntry(), 'pb-verde');
    expect(colourway).toBeNull();
    expect(problem?.code).toBe('colourway_not_supported');
  });

  it('leaves a voice entry alone when nothing is requested', () => {
    const { colourway, problem } = resolveRequestedColourway(voiceEntry(), undefined);
    expect(colourway).toBeNull();
    expect(problem).toBeNull();
  });

  it('treats an empty string as "no request"', () => {
    const { colourway, problem } = resolveRequestedColourway(entry(), '   ');
    expect(problem).toBeNull();
    expect(colourway?.id).toBe('pb-gold-on-obsidian');
  });

  it('ignores a non-string request rather than coercing it', () => {
    for (const bogus of [42, {}, [], true]) {
      const { problem } = resolveRequestedColourway(entry(), bogus);
      expect(problem).toBeNull();
    }
  });
});

describe('baking the colourway into the copy', () => {
  const base = {
    userId: 'user-1',
    name: 'My Chancery',
    entry: entry(),
    schema: CHANCERY.schema,
  };

  it('writes the chosen palette into the copy\'s own tokens', () => {
    // Baked rather than referenced: the Builder, the WeasyPrint PDF and live
    // report generation then all see an ordinary template that happens to be
    // that colour, with nothing to resolve.
    const colourway = findColourway('private_banking', 'pb-deep-verde')!;
    const payload = buildWorkingCopyPayload({ ...base, colourway });
    const colors = (payload.schema as any).tokens.colors;
    expect(colors).toMatchObject(colourwayColors(colourway));
  });

  it('leaves the library entry\'s schema untouched', () => {
    const before = JSON.stringify(CHANCERY.schema);
    buildWorkingCopyPayload({
      ...base,
      colourway: findColourway('private_banking', 'pb-oxblood-night')!,
    });
    expect(JSON.stringify(CHANCERY.schema)).toBe(before);
  });

  it('keeps the stored palette when no colourway is chosen', () => {
    const payload = buildWorkingCopyPayload({ ...base, colourway: null });
    expect(payload.schema).toBe(CHANCERY.schema);
  });

  it('records lineage a person can read months later', () => {
    const colourway = findColourway('private_banking', 'pb-platinum')!;
    const payload = buildWorkingCopyPayload({ ...base, colourway });
    const lineage = (payload.config as any).libraryLineage;
    expect(lineage).toMatchObject({
      entryId: 'entry-1',
      entrySlug: CHANCERY.slug,
      entryVersion: 1,
      familyKey: 'private_banking',
      templateCode: 'pb-01',
      colourway: 'pb-platinum',
      colourwayName: 'Platinum',
      ground: 'light',
    });
  });

  it('preserves any config the entry already carried', () => {
    const payload = buildWorkingCopyPayload({
      ...base,
      entry: entry({ config: { existingKey: 'kept' } }),
      colourway: null,
    });
    expect((payload.config as any).existingKey).toBe('kept');
    expect((payload.config as any).libraryLineage).toBeDefined();
  });

  it('writes the lineage on a copy of a non-family template too', () => {
    /*
     * This used to assert the opposite, on the reasoning that a voice
     * template has no family, no variant axis and no colourway and would
     * carry eleven null fields for nothing.
     *
     * The eleven fields are not what the block is for. `entryId` is, and four
     * readers key identity on it: the picker's stored-choice resolution, its
     * "is this the current one" mark, `matchesReportUseCopy` (which opens
     * `if (!lineage) return false`) and the SQL dedupe on
     * `config->libraryLineage->>entryId`. Without it a voice template adopted
     * for reports came back unrecognisable — not marked current, listed a
     * second time as a standalone template, and minting another active
     * `report_templates` row on every save.
     */
    const payload = buildWorkingCopyPayload({
      ...base,
      entry: { ...voiceEntry(), config: { a: 1 } },
      colourway: null,
    });
    expect(payload.config.a).toBe(1);
    expect(payload.config.libraryLineage.entryId).toBe(voiceEntry().id);
    // The family half is null rather than absent — there is no family to name.
    expect(payload.config.libraryLineage.familyKey).toBeNull();
    expect(payload.config.libraryLineage.colourway).toBeNull();
  });

  it('still refuses to make the copy live, owned or default', () => {
    // Re-asserted on the colourway path. A new argument to this function is
    // exactly how one of these would get quietly dropped.
    const payload = buildWorkingCopyPayload({
      ...base,
      colourway: findColourway('private_banking', 'pb-navy-signet')!,
    });
    expect(payload).toMatchObject({
      is_active: false,
      is_default: false,
      is_draft: true,
      approval_status: 'draft',
      locked_for_review: false,
      scope: 'user',
      owner_user_id: 'user-1',
      agency_id: null,
      created_by: null,
      parent_template_id: null,
      version: 1,
      priority: 0,
    });
  });

  it('carries the report type through so the copy stays Investment Compass', () => {
    const payload = buildWorkingCopyPayload({ ...base, colourway: null });
    expect(payload.report_type).toBe('investment_compass');
  });
});

describe('every colourway can be copied', () => {
  it.each(PRIVATE_BANKING_COLOURWAYS.map((c) => [c.name, c.id] as const))(
    '%s',
    (_name, id) => {
      const { colourway, problem } = resolveRequestedColourway(entry(), id);
      expect(problem).toBeNull();
      const payload = buildWorkingCopyPayload({
        userId: 'user-1',
        name: 'Copy',
        entry: entry(),
        schema: CHANCERY.schema,
        colourway,
      });
      const colors = (payload.schema as any).tokens.colors;
      expect(colors.primary).toBe(colourway!.accent);
      expect((payload.config as any).libraryLineage.colourway).toBe(id);
    },
  );
});
