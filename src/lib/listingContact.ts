/**
 * Browser entry point for contact resolution.
 *
 * Implementation lives in `supabase/functions/_shared/listingContact.pure.ts` so
 * the enrichment sweep and the UI agree on which address counts as reachable —
 * the sweep uses it to decide whether an agent contact is still missing, and the
 * UI uses it to decide whether to offer the email action at all.
 */
import type { PropertyListing } from '@/lib/airtable';
import {
  resolveContact,
  type ResolvedContact,
} from '../../supabase/functions/_shared/listingContact.pure';

export {
  cleanContactEmail,
  cleanContactPhone,
  describeContactSource,
  isIntakeOperatorEmail,
  resolveContact,
  resolveContactFromFields,
  type ContactSource,
  type ResolvedContact,
} from '../../supabase/functions/_shared/listingContact.pure';

/** The contact for a projected listing. */
export function listingContact(listing: PropertyListing): ResolvedContact {
  return resolveContact({
    agentEmail: listing.agentEmail,
    agencyEmail: listing.agencyEmail,
    senderEmail: listing.senderEmail,
    agentMobile: listing.agentMobile,
    agentPhone: listing.agentPhone,
    agencyPhone: listing.agencyPhone,
    agentName: listing.agentName,
    senderName: listing.senderName,
    agencyName: listing.agencyName,
  });
}
