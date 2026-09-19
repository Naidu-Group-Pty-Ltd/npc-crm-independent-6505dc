/**
 * Regeneration parity — a regenerated report must draw on the same measured
 * readings, through the same renderings, as a freshly generated one.
 *
 * The drift this pins was live: `regenerate-report-qualitative` composed its
 * own copies of the crime and climate context from the PRE-2026-09 service
 * shapes (`crime.safetyScore`, `crime.comparisonToState`,
 * `climate.climateZone`, `climate.temperature.summer`), every one of which
 * the crime and climate reworks deleted — so eight labelled rows resolved to
 * "N/A" on every regenerated report, which is precisely the "blank a model
 * should fill" invitation this programme exists to remove. It also called
 * the climate service with a locality and no coordinate (so after the SILO
 * rewrite it refused unconditionally), and never called planning or
 * regional trends at all.
 *
 * The rules, in the order they bite:
 *  1. one rendering per reading — both paths import the shared prompt block;
 *  2. no path reads a field the services no longer produce;
 *  3. the coordinate-keyed services are asked WITH the coordinate;
 *  4. a source attribution names the register that actually served it.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const fn = (p: string) => readFileSync(join(__dirname, '../../../../supabase/functions', p), 'utf-8');

const GENERATOR = 'generate-investment-report/index.ts';
const REGENERATOR = 'regenerate-report-qualitative/index.ts';

/** Strip comments: this file's own prose names the very fields it bans. */
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('regeneration parity', () => {
  const generator = code(fn(GENERATOR));
  const regenerator = code(fn(REGENERATOR));

  it('both paths render each reading through the one shared block', () => {
    for (const block of [
      'crimeStatBlocks',
      'climateStatBlocks',
      'planningStatBlocks',
      'regionalTrendBlocks',
      'macroEconomicBlock',
    ]) {
      expect(generator, `${block} missing from the generator`).toContain(block);
      expect(regenerator, `${block} missing from the regeneration path`).toContain(block);
    }
  });

  it('neither path reads a field the reworked services no longer produce', () => {
    // Deleted by the crime rework (and banned outright by its own spec), and
    // by the climate rework — a reader of these renders "N/A" for ever.
    for (const dead of [
      'safetyScore',
      'comparisonToState',
      'climateZone',
      'temperature?.summer',
      'temperature?.winter',
      'rainfall?.annual',
    ]) {
      expect(generator, `generator still reads ${dead}`).not.toContain(dead);
      expect(regenerator, `regeneration path still reads ${dead}`).not.toContain(dead);
    }
  });

  it('asks every coordinate-keyed service with the coordinate, by a literal URL', () => {
    // Each of these answers `no_data_for_location` without a coordinate, so
    // a call passing only a locality can never succeed. The URL must also be
    // LITERAL at the call site: the security inventory builds its call graph
    // by scanning for `functions/v1/<name>`, so routing a call through a
    // helper that assembles the name makes the edge invisible to it — which
    // is exactly what happened to the climate edge when this block was
    // first written.
    for (const service of ['climate-data-service', 'planning-data-service', 'abs-regional-service']) {
      expect(regenerator, `${service} is not called by a literal URL on the regeneration path`)
        .toContain(`/functions/v1/${service}`);
    }
    // The block that carries them resolves the coordinate first.
    expect(regenerator).toMatch(/await locationTask[\s\S]{0,400}coordinates\?\.lat/);
    expect(regenerator).toMatch(/latitude: lat, longitude: lng/);
  });

  it('attributes each source to the register that actually serves it', () => {
    // The SILO licence asks for its own attribution; the others were simply
    // untrue of this pipeline.
    expect(regenerator).toContain('SILO Data Drill (Queensland Government)');
    expect(regenerator).not.toContain('**Bureau of Meteorology (BOM)**');
    expect(regenerator).not.toContain('ACARA/MySchool');
    expect(regenerator).not.toContain('NAPLAN');
    expect(regenerator).not.toContain('Domain/CoreLogic');
    expect(regenerator).not.toContain('ABS Labour Force Survey');
    expect(regenerator).not.toMatch(/safety scores/i);
  });
});
