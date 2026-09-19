/**
 * Client-facing presentation of the four identity documents NPC accepts.
 *
 * The union, the list and the validator come from
 * `supabase/functions/_shared/aml/identityDocuments.pure.ts` — the same module
 * the Edge Function allow-lists against — so the portal cannot offer a choice
 * the server would refuse, and adding a fifth document is one edit rather than
 * two that can drift apart.
 *
 * What deliberately does NOT come across that boundary is the provider's
 * vocabulary. There is no document code, no country code, no workflow id and
 * no vendor name in this file: the browser declares an intent in NPC's words
 * and the server translates it. See `providers/didit.pure.ts`.
 *
 * ## Australia is not a question
 *
 * Every option below is an Australian document and none of them says so in a
 * selector. The customer is never asked to pick a country — it is applied
 * server-side on every session — so the word appears only where it helps them
 * recognise their own document.
 */
export {
  IDENTITY_DOCUMENT_CHOICES,
  parseDocumentChoice,
  // The capture plan crosses too, and for the same reason as the list itself:
  // the camera must ask for exactly the photographs the server will require.
  // Two answers to "does this document have a back?" is a customer who
  // photographs one side and is refused at submission, or who is asked for a
  // side their passport does not have.
  IDENTITY_CAPTURE_KINDS,
  identityDocumentCapturePlan,
  requiredCaptureKinds,
  type IdentityCaptureKind,
  type IdentityCapturePlan,
  type IdentityDocumentChoice,
} from '../../../supabase/functions/_shared/aml/identityDocuments.pure';
import type { IdentityDocumentChoice } from '../../../supabase/functions/_shared/aml/identityDocuments.pure';

export interface IdentityDocumentPresentation {
  /** What the client sees on the option. */
  label: string;
  /** One line under the label — what counts, in their words. */
  hint: string;
  /** Shown on the launch screen so they fetch the right thing first. */
  bring: string;
}

/**
 * Copy for each option.
 *
 * Written for someone holding the document, not for someone who knows what a
 * "government-issued photographic identity document" is. Medicare cards,
 * concession cards and health cards are absent on purpose and are not
 * mentioned: naming a document only to refuse it invites the client to try it.
 */
export const IDENTITY_DOCUMENT_PRESENTATION:
Record<IdentityDocumentChoice, IdentityDocumentPresentation> = {
  passport: {
    label: 'Australian passport',
    hint: 'Current, or expired within the last two years',
    bring: 'your passport, open at the photo page',
  },
  driver_licence: {
    label: 'Australian driver licence',
    hint: 'Full, provisional or learner licence from any state or territory',
    bring: 'your driver licence — you will photograph both sides',
  },
  identity_card: {
    label: 'Photo identity card',
    hint: 'A state or territory proof-of-age or photo ID card',
    bring: 'your photo identity card — you will photograph both sides',
  },
  residence_permit: {
    label: 'Australian residence permit',
    hint: 'An ImmiCard or other residence document with your photograph',
    bring: 'your residence document, open at the photo page',
  },
};

/**
 * What the client needs before they start, in the order they will need it.
 *
 * The document line is per-choice; the rest is constant. Shown as a checklist
 * because the failure this screen exists to prevent is someone pressing Begin
 * and then leaving to find their wallet while a session runs.
 */
export function identityCheckRequirements(choice: IdentityDocumentChoice): string[] {
  return [
    IDENTITY_DOCUMENT_PRESENTATION[choice].bring,
    'a device with a camera — the one you are using now is fine',
    'about one to two minutes, somewhere with even light',
  ];
}
