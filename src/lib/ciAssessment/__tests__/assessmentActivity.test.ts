/**
 * An assessment's audit trail, in words — and never in the database's.
 *
 * Every event type the two functions write has a phrase of its own, read from
 * their source so a new event is noticed here rather than on the page; and an
 * event this module does not know degrades to a neutral phrase, never to its
 * underscore-cased name.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { activityDetail, activityLabel, isDescribedActivity } from '../assessmentActivity';

function eventTypesWritten(): string[] {
  const sources = [
    readFileSync('supabase/functions/manage-ci-assessments/index.ts', 'utf8'),
    readFileSync('supabase/functions/render-commercial-capacity-pdf/index.ts', 'utf8'),
  ].join('\n');
  const written = new Set<string>();
  for (const match of sources.matchAll(/writeAudit\(\s*[\w.]+,\s*'([a-z_]+)'/g)) written.add(match[1]);
  for (const match of sources.matchAll(/event_type: '([a-z_]+)'/g)) written.add(match[1]);
  // The archive operation chooses between two names in one call.
  for (const match of sources.matchAll(/\?\s*'(assessment_[a-z_]+)'\s*:\s*'(assessment_[a-z_]+)'/g)) {
    written.add(match[1]);
    written.add(match[2]);
  }
  return [...written].sort();
}

describe('the audit trail, in words', () => {
  it('has a phrase for every event the functions write', () => {
    const written = eventTypesWritten();
    expect(written).toContain('report_generated');
    expect(written).toContain('assessment_archived');
    expect(written.filter((type) => !isDescribedActivity(type))).toEqual([]);
  });

  it('never shows the database’s own name for an event it does not know', () => {
    const label = activityLabel({ event_type: 'something_new_happened', detail: {} });
    expect(label).toBe('Change recorded');
    expect(label).not.toMatch(/_/);
  });

  it('says which route drew a report, and names the file', () => {
    expect(activityLabel({ event_type: 'report_generated', detail: { route: 'capacity_report' } })).toBe('Report generated');
    const templated = { event_type: 'report_generated', detail: { route: 'template', fileName: 'a.pdf', templateName: 'Harbour' } };
    expect(activityLabel(templated)).toBe('Report generated from a template');
    expect(activityDetail(templated)).toBe('a.pdf · Harbour');
  });

  it('names what an assessment was renamed to', () => {
    expect(activityDetail({ event_type: 'assessment_renamed', detail: { from: 'Old', to: 'New name' } })).toBe('New name');
  });
});
