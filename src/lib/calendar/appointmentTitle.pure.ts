/**
 * The title Quick Add suggests for a booking.
 *
 * Audit item 22: choosing "Zoom Meeting" and a client produced "Zoom Meeting
 * with <client>", and switching the type to "Phone Call" left the title saying
 * Zoom. The title was written once, inside the contact picker, and nothing ever
 * revisited it — so a booking could go out named after a call type it was not.
 *
 * The rule that makes re-deriving safe: a SUGGESTION may be replaced, and
 * anything the operator typed may never be.
 */

export interface AppointmentTitleInput {
  /** The label of the selected appointment type, e.g. "Phone Call". */
  typeLabel: string;
  /** The chosen contact's display name, if one is chosen. */
  contactName?: string | null;
}

/**
 * The title Quick Add would suggest for this type and contact.
 *
 * With no contact it is the type alone rather than a dangling "with", so the
 * suggestion is still a usable title before anyone is picked.
 */
export function suggestedAppointmentTitle({
  typeLabel,
  contactName,
}: AppointmentTitleInput): string {
  const name = (contactName ?? '').trim();
  const label = typeLabel.trim() || 'Appointment';
  return name ? `${label} with ${name}` : label;
}
