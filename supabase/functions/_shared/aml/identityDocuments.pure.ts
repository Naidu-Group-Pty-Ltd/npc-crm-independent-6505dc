/**
 * The identity documents NPC asks a client to choose between.
 *
 * Pure and dependency-free so the browser, the Edge Function and the tests all
 * read the SAME four values. It is deliberately NPC's vocabulary and not any
 * provider's: nothing in this module names a verification vendor, carries a
 * vendor's document code, or knows which workflow runs. The provider mapping
 * lives with the provider (`providers/didit.pure.ts`), which is what keeps the
 * portal bundle free of it.
 *
 * ## Why the browser may declare this at all
 *
 * The choice is a statement of INTENT — "I am going to hold up my licence" —
 * and its only effect is to narrow the document picker the customer is shown.
 * It selects no provider, no workflow, no environment and no outcome. That
 * distinction is why `parseDocumentChoice` exists: the value arrives from a
 * browser, so it is matched against a closed list and anything else is
 * refused rather than passed through to a provider payload.
 *
 * ## Why there is no country
 *
 * NPC verifies Australian documents only, and the customer is never asked to
 * say so. `IDENTITY_DOCUMENT_COUNTRY` is applied server-side on every session,
 * so a browser cannot widen it and a customer cannot get it wrong.
 */

export type IdentityDocumentChoice =
  | 'passport'
  | 'driver_licence'
  | 'identity_card'
  | 'residence_permit';

/**
 * The closed list, in the order the client is offered them.
 *
 * Passport first because it is the single document that satisfies the
 * requirement on its own and needs no supporting evidence.
 */
export const IDENTITY_DOCUMENT_CHOICES: readonly IdentityDocumentChoice[] = [
  'passport',
  'driver_licence',
  'identity_card',
  'residence_permit',
] as const;

/**
 * ISO 3166-1 alpha-3, per the Session API's `expected_details.id_country`.
 *
 * Alpha-3 and not alpha-2: the documented field takes `GBR`/`USA`, so `AU`
 * would be rejected or — worse — silently ignored, which reads on our side as
 * "the restriction is applied" while the customer is still shown a global
 * country picker.
 */
export const IDENTITY_DOCUMENT_COUNTRY = 'AUS';

/**
 * Validate a browser-supplied document choice against the closed list.
 *
 * Returns `null` for absent, unknown, mistyped or non-string input. Callers
 * distinguish the two: absent means "the client did not declare one" and is
 * allowed (an older portal build, or a resumed session), while present-and-
 * unrecognised is a rejected request. Collapsing those would let a typo
 * silently become an unrestricted session.
 */
export function parseDocumentChoice(value: unknown): IdentityDocumentChoice | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  return (IDENTITY_DOCUMENT_CHOICES as readonly string[]).includes(trimmed)
    ? trimmed as IdentityDocumentChoice
    : null;
}

/** Whether a value is a supported choice. Absent is NOT supported. */
export function isDocumentChoice(value: unknown): value is IdentityDocumentChoice {
  return parseDocumentChoice(value) !== null;
}

/* ───────────────────────── capture plan ─────────────────────────────────── */

/** The three photographs an NPC-owned capture can ask for. */
export type IdentityCaptureKind = 'document_front' | 'document_back' | 'selfie';

export const IDENTITY_CAPTURE_KINDS: readonly IdentityCaptureKind[] = [
  'document_front', 'document_back', 'selfie',
] as const;

export interface IdentityCapturePlan {
  document_front: true;
  document_back: boolean;
  selfie: true;
}

/**
 * Which photographs the chosen document needs.
 *
 * Shared by the camera, the upload-grant issuer and the submission validator so
 * that "did they give us everything?" is answered once. Asking a passport
 * holder to photograph a back that does not exist is a dead end; accepting a
 * driver licence with only its front is worse, because the back is where the
 * card number and the address live and the provider is then judging half a
 * document.
 *
 * ## Where these answers come from
 *
 * Not from the provider, and not invented here: they are the requirements NPC
 * already publishes to the customer in `IDENTITY_DOCUMENT_PRESENTATION.bring`
 * (`src/lib/aml/identityDocuments.ts`). Two of the four say "you will photograph
 * both sides" — the driver licence and the photo identity card — and the other
 * two say "open at the photo page". That copy is the approved statement of what
 * NPC asks for, so it is what this mirrors rather than a second opinion that
 * could disagree with what the customer was told to expect.
 *
 * `residence_permit` therefore takes a front only. It is the one entry whose
 * source is a sentence rather than a policy document, and the ImmiCard is a
 * card — so if the accepted-document policy is ever written down formally, this
 * is the line to check first. It is deliberately NOT guessed upward: requiring
 * a back nobody told the customer about would strand anyone holding a document
 * that has nothing on it.
 *
 * A back is never *forbidden* by the provider — `back_image` is optional on the
 * ID Verification API — so this decides what NPC ASKS FOR and what it REQUIRES,
 * which is the same thing here by design: an optional capture is a capture some
 * customers skip and others do not, and evidence that varies per customer is
 * harder to adjudicate than evidence that does not.
 */
export function identityDocumentCapturePlan(
  choice: IdentityDocumentChoice,
): IdentityCapturePlan {
  return {
    document_front: true,
    document_back: choice === 'driver_licence' || choice === 'identity_card',
    selfie: true,
  };
}

/** The capture kinds required for a choice, in the order they are taken. */
export function requiredCaptureKinds(
  choice: IdentityDocumentChoice,
): IdentityCaptureKind[] {
  const plan = identityDocumentCapturePlan(choice);
  return IDENTITY_CAPTURE_KINDS.filter((kind) => plan[kind] === true);
}

/** Validate a browser-supplied capture kind against the closed list. */
export function parseCaptureKind(value: unknown): IdentityCaptureKind | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  return (IDENTITY_CAPTURE_KINDS as readonly string[]).includes(trimmed)
    ? trimmed as IdentityCaptureKind
    : null;
}

/**
 * The path the hosted flow returns the customer to.
 *
 * A constant, and never assembled from anything a browser sent. The callback
 * is handed to the provider, so a client-supplied one would be an open
 * redirect minted by NPC's own server under NPC's own origin.
 */
export const IDENTITY_RETURN_PATH = '/client/aml/identity-return';

/**
 * The absolute return URL handed to the provider.
 *
 * `configuredOrigin` is the deployment's own `PUBLIC_APP_URL` and
 * `fallbackOrigin` is a compiled-in constant. Neither is ever the request's
 * `Origin` header, and there is no parameter through which a browser could
 * influence the result: the provider redirects the customer to whatever this
 * returns, so an origin taken from the caller would turn NPC's server into the
 * author of an open redirect.
 *
 * A configured origin that is not a parseable absolute `https:`/`http:` URL is
 * discarded rather than concatenated. A typo like `command-centre.npc...`
 * (no scheme) would otherwise produce a relative string that the provider
 * either refuses or resolves against its own host — sending the customer to
 * the provider's 404 instead of back to NPC.
 */
export function identityReturnUrl(
  configuredOrigin: string | null | undefined,
  fallbackOrigin: string,
): string {
  const origin = safeOrigin(configuredOrigin) ?? safeOrigin(fallbackOrigin);
  if (!origin) throw new Error('identityReturnUrl: no usable origin');
  return `${origin}${IDENTITY_RETURN_PATH}`;
}

function safeOrigin(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.origin;
  } catch {
    return null;
  }
}
