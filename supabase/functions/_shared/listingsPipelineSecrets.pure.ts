/**
 * The Airtable names the Listings & Overview pipeline runs on — and the one
 * rule about them: the Integrations page can never write them.
 *
 * ## What this fixes
 *
 * The Integrations page's Airtable card collected `AIRTABLE_API_KEY` and
 * mapped it onto `AIRTABLE_TOKEN` before writing it into the project's
 * environment through the Management API. `AIRTABLE_TOKEN` is the key
 * `airtable-proxy`, `listings-cache`, `listing-images` and `listing-enrichment`
 * read — so a key typed on that page superseded the one the Listings page
 * runs on, silently, on whichever deployment it was typed on.
 *
 * Since 6 Sep 2026 that key is ONE value across the prime and every clone,
 * managed by Mission Control (it forwards it at provisioning and on request),
 * and the page's Airtable card is the workflow connection under its own names
 * (`AIRTABLE_API_KEY`, `AIRTABLE_WORKFLOW_BASE_ID`).
 *
 * Pure: no Deno, so the frontend tests import it too.
 */

/** Every name the Listings pipeline reads. Names only — the values live in Mission Control. */
export const LISTINGS_PIPELINE_SECRETS: ReadonlySet<string> = new Set([
  'AIRTABLE_TOKEN',
  'AIRTABLE_BASE_ID',
  'AIRTABLE_TABLE_NAME',
  'AIRTABLE_TABLE_ALLOWLIST',
  'AIRTABLE_TABLE_ALIASES',
  'AIRTABLE_IMAGE_LIBRARY_FIELD',
]);

/** Null when the page may write the name; otherwise the refusal, in the operator's terms. */
export function listingsPipelineRefusal(name: string): string | null {
  if (!LISTINGS_PIPELINE_SECRETS.has(name)) return null;
  return (
    `${name} is the Listings & Overview pipeline's Airtable configuration. It is the same across ` +
    `the prime and every clone and is managed by Mission Control, so it cannot be set from this page. ` +
    `The Airtable card here configures the workflow connection (AIRTABLE_API_KEY, AIRTABLE_WORKFLOW_BASE_ID) only.`
  );
}
