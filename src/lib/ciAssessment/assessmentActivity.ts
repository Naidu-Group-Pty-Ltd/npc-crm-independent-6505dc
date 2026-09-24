/**
 * An assessment's audit trail, in words.
 *
 * `manage-ci-assessments` writes an event for everything that changes state,
 * and `render-commercial-capacity-pdf` writes `report_generated` — and until
 * the Documents panel nothing ever showed any of it (`MODULE_STRUCTURE.md` G8).
 * The event names are the database's; they never reach the page. An event this
 * module does not know is described as a recorded change rather than by its
 * name, so a new event type degrades to vague rather than to jargon.
 */

export interface ActivityEvent {
  event_type: string;
  detail: Record<string, unknown> | null;
}

const LABELS: Readonly<Record<string, string>> = {
  assessment_created: 'Assessment started',
  assessment_renamed: 'Renamed',
  section_updated: 'Details updated',
  calculation_run: 'Calculation run',
  scenario_saved: 'Scenario saved',
  assessment_completed: 'Completed',
  client_intended: 'Prepared for a client',
  client_created: 'Client record created from this assessment',
  client_linked: 'Linked to a client',
  client_unlinked: 'Unlinked from its client',
  assessment_archived: 'Archived',
  assessment_restored: 'Restored',
  report_generated: 'Report generated',
};

const UNKNOWN = 'Change recorded';

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** What happened, in one short phrase. */
export function activityLabel(event: ActivityEvent): string {
  if (event.event_type === 'report_generated' && event.detail?.route === 'template') {
    return 'Report generated from a template';
  }
  return LABELS[event.event_type] ?? UNKNOWN;
}

/** The one fact worth adding to the phrase, when there is one. */
export function activityDetail(event: ActivityEvent): string | null {
  const detail = event.detail ?? {};
  switch (event.event_type) {
    case 'report_generated':
      return [text(detail.fileName), text(detail.templateName)].filter(Boolean).join(' · ') || null;
    case 'assessment_renamed':
      return text(detail.to);
    default:
      return null;
  }
}

/** Whether an event type has words of its own here. */
export function isDescribedActivity(eventType: string): boolean {
  return eventType in LABELS;
}
