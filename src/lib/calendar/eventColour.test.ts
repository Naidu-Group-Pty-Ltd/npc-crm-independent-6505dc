/**
 * The calendar's colour vocabulary — audit items 19, 23 and 24.
 *
 * All three were one mistake made three ways: a mark whose meaning was decided
 * locally, so the same colour said different things in panels sitting side by
 * side, and a scale that measured the wrong thing.
 */
import { describe, expect, it } from 'vitest';

import {
  WORKLOAD_BANDS,
  eventColourSource,
  statusBadgeClass,
  statusLabel,
  workloadBand,
  workloadLegend,
} from './eventColour.pure';

describe('eventColourSource', () => {
  it('lets a live booking keep its calendar colour', () => {
    // Item 23: `confirmed` had its own green branch, so every live booking on
    // the grid was green and no calendar colour ever reached a pill.
    expect(eventColourSource('confirmed')).toBe('calendar');
    expect(eventColourSource('booked')).toBe('calendar');
    expect(eventColourSource('showed')).toBe('calendar');
    expect(eventColourSource('pending')).toBe('calendar');
    expect(eventColourSource(null)).toBe('calendar');
    expect(eventColourSource('')).toBe('calendar');
  });

  it('overrides only for a state that is not going ahead', () => {
    for (const status of ['cancelled', 'canceled', 'no_show', 'noshow', 'no-show', 'rescheduled']) {
      expect(eventColourSource(status)).toBe('status');
    }
  });

  it('reads a status whatever case or spacing it arrives in', () => {
    expect(eventColourSource('  CANCELLED ')).toBe('status');
    expect(eventColourSource('Confirmed')).toBe('calendar');
  });
});

describe('workloadBand', () => {
  it('does not call a single meeting a very busy day', () => {
    // Item 19: intensity was `count / maxEvents`, so on a month whose fullest
    // day held one meeting that day scored 1.0 and was painted red.
    const band = workloadBand(1);
    expect(band.id).toBe('light');
    expect(band.label).toBe('Light');
  });

  it('measures an absolute count, not a share of the busiest day', () => {
    // The same count means the same thing in a quiet month and a full one.
    expect(workloadBand(1).id).toBe('light');
    expect(workloadBand(2).id).toBe('light');
    expect(workloadBand(3).id).toBe('moderate');
    expect(workloadBand(5).id).toBe('busy');
    expect(workloadBand(7).id).toBe('full');
    expect(workloadBand(40).id).toBe('full');
  });

  it('treats an empty day as free, and never as an error', () => {
    for (const count of [0, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(workloadBand(count).id).toBe('free');
    }
  });

  it('gives an empty day a fill that is visible on the dark ground', () => {
    // `bg-muted/30` was reported as blending into the page, so an empty day
    // looked like a rendering fault rather than an empty day.
    expect(workloadBand(0).cell).not.toMatch(/\/(?:[0-3]?\d)\b/);
  });

  it('gives every band a swatch distinguishable from the others', () => {
    // `--brand` was used for Moderate and is white-labelled — gold by default,
    // which is `--warning`'s hue — so Moderate and Busy rendered as the same
    // swatch. A token a tenant can re-hue cannot carry a step on a fixed scale.
    const fills = workloadLegend().map((b) => b.cell.split(' ')[0]);
    expect(new Set(fills).size).toBe(fills.length);
    for (const band of workloadLegend()) {
      expect(band.cell).not.toMatch(/brand/);
    }
  });

  it('offers a legend entry for every band, in order', () => {
    const legend = workloadLegend();
    expect(legend.map((b) => b.id)).toEqual(WORKLOAD_BANDS.map((b) => b.id));
    // Drawn from the same source as the cells, so it cannot describe a scale
    // the grid is not using.
    for (const band of legend) {
      expect(band.swatch).toContain(band.cell.split(' ')[0]);
    }
  });
});

describe('statusBadgeClass', () => {
  it('never paints a status with a bare colour swatch', () => {
    // Item 24: a status was a coloured dot, exactly like a calendar's. Form is
    // what separates the two vocabularies, so a status is always a badge.
    for (const status of ['confirmed', 'booked', 'noshow', 'cancelled', 'pending', 'anything']) {
      expect(statusBadgeClass(status)).toMatch(/rounded-full/);
      expect(statusBadgeClass(status)).toMatch(/border/);
    }
  });

  it('uses semantic tokens rather than hardcoded hexes', () => {
    for (const status of ['confirmed', 'booked', 'noshow', 'cancelled', 'pending', 'unknown']) {
      expect(statusBadgeClass(status)).not.toMatch(/#[0-9a-f]{3,8}/i);
    }
  });

  it('always resolves to something legible', () => {
    expect(statusBadgeClass('a-status-nobody-declared')).toMatch(/text-/);
    expect(statusBadgeClass(null)).toMatch(/text-/);
  });
});

describe('statusLabel', () => {
  it('never shows a raw underscored identifier', () => {
    expect(statusLabel('no_show')).toBe('No show');
    expect(statusLabel('confirmed')).toBe('Confirmed');
    expect(statusLabel('')).toBe('Unknown');
  });
});
