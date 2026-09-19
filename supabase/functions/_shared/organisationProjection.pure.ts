/**
 * Project the deployment's `whitelabel_settings` row into the `org` namespace.
 *
 * ## Every generated document had a blank letterhead, on every format
 *
 * `disclaimerPage()` is the last page of all 293 seeded templates, and it binds
 * `{{org.name}}`, `{{org.abn}}`, `{{org.address}}`, `{{org.phone}}`,
 * `{{org.email}}` and `{{org.website}}`. The family covers bind `{{org.name}}`
 * as the wordmark on top of that.
 *
 * **Nothing published `org`.** Not one adapter, not the edge mirror, not the
 * render route — the namespace had no producer anywhere in the codebase. An
 * unresolved binding renders as the empty string rather than as a visible
 * `{{…}}`, so the contact block at the foot of every report printed its labels
 * with nothing beside them, and the cover wordmark was blank. The `disclaimer`
 * block even carries a `?? 'Property Consulting'` default, which never fired:
 * the prop was *present*, it just resolved to nothing.
 *
 * `reportBindingProjection.spec.ts` has listed these six as "organisation,
 * adviser and client identity live outside this row" since it was written —
 * true of the *report* row, and read for four months as though it meant no
 * source existed. One does: `whitelabel_settings`, one row, the same table the
 * Branding page writes.
 *
 * ## Four of the six resolve, and two do not
 *
 * Measured against the live row:
 *
 * | Binding | Column | Present |
 * | --- | --- | --- |
 * | `org.name` | `company_name` | yes |
 * | `org.phone` | `email_signature_phone` | yes — `02 8609 3299` |
 * | `org.email` | `email_signature_email` | yes |
 * | `org.website` | `email_signature_website` | yes |
 * | `org.address` | `email_signature_address` | **empty string** |
 * | `org.abn` | — | **no column** |
 *
 * The two that cannot be filled stay absent rather than being defaulted. An ABN
 * is a legal identifier; a plausible-looking wrong one on a client's financial
 * report is materially worse than a missing line, and the disclaimer block
 * already omits a row whose value is empty.
 *
 * ## Why the email-signature columns, when a report is not an email
 *
 * `REPORT_RULES.md` is blunt that most of this repo's "logo" files are
 * email-signature banners carrying the director's personal mobile number, and
 * that they must not reach a report. That warning is about the **banner image**,
 * and it does not extend to these four fields by default — but it is the reason
 * this module reads them one at a time rather than spreading the object:
 *
 *  - `email_signature_phone` is `02 8609 3299`, a Sydney landline. Checked,
 *    because a mobile here would be the exact defect that rule exists for.
 *  - `email_signature_banner` is **not read**. It is the image the rule names.
 *  - `email_signature_disclaimer` is **not read**. Templates carry
 *    `STANDARD_DISCLAIMER`, which is written for print; the signature's is
 *    written for the foot of an email and is a different document's text.
 *  - `email_signature_name` / `_title` are **not read as an author**. On this
 *    deployment they hold "NPC Services" and "Property Investment Specialist" —
 *    the organisation and a role, not the person who prepared the report. There
 *    is no `profiles` table, so `author.name` has no source and the templates
 *    no longer claim one.
 *
 * If a deployment later grows a real organisation record with an ABN and a
 * postal address, this module is the one place that changes.
 */

export interface OrganisationRowLike {
  company_name?: string | null;
  email_signature_phone?: string | null;
  email_signature_email?: string | null;
  email_signature_website?: string | null;
  email_signature_address?: string | null;
  [k: string]: unknown;
}

/** The columns this projection reads, for a `select()` that pulls nothing else. */
export const ORGANISATION_COLUMNS =
  'company_name, email_signature_phone, email_signature_email, '
  + 'email_signature_website, email_signature_address';

function str(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  return s || undefined;
}

function put(target: Record<string, unknown>, key: string, value: unknown): void {
  if (value !== undefined && value !== null && value !== '') target[key] = value;
}

/**
 * The `org` namespace, with absent meaning absent.
 *
 * `company_name` is trimmed because the stored value carries a trailing space,
 * and a wordmark set from it would be typeset with it.
 */
export function projectOrganisation(row: OrganisationRowLike | null | undefined): Record<string, unknown> {
  const org: Record<string, unknown> = {};
  if (!row) return org;
  put(org, 'name', str(row.company_name));
  put(org, 'phone', str(row.email_signature_phone));
  put(org, 'email', str(row.email_signature_email));
  put(org, 'website', str(row.email_signature_website));
  // Empty on the live row; published where a deployment fills it in, and
  // `contact_details` below fills it in on this one.
  put(org, 'address', str(row.email_signature_address));
  // `abn` is not here because this row has no such column. It is not "nowhere"
  // — see `projectReportSettings`.
  return org;
}

/**
 * The report settings the render routes already read, projected into `org`.
 *
 * ## The ABN was never missing, it was in the other table
 *
 * This module's header says `org.abn` has "no column" and `org.address` is an
 * empty string. Both statements are true of `whitelabel_settings` and false of
 * the deployment: `global_report_settings.contact_details` carries
 *
 *     abn      50 684 555 771
 *     address  Level 5 Nexus Norwest, 4 Columbia Ct, Norwest NSW 2153
 *
 * and every render route already selects that row — `render-cash-flow-pdf` and
 * its siblings fetch `contact_details` and `professional_disclaimer` together.
 * The value reached the legacy composer and stopped there, so the design
 * system's contact block printed four lines where the firm has six.
 *
 * ## And the disclaimer is a setting, not a constant
 *
 * `disclaimerPage()` bakes `STANDARD_DISCLAIMER` — five lines of generic
 * boilerplate — into the schema of all 543 seeded templates. The deployment has
 * `professional_disclaimer` set: **~1,400 characters over nine paragraphs**,
 * `is_enabled: true`, written for a Buyers Agent and naming the risks that
 * business carries. It reached the legacy composer and nothing else, so every
 * design-system document carried the wrong disclaimer — the generic one, in
 * place of the one the firm wrote and turned on.
 *
 * That is the defect behind "none of the templates are rendering the disclaimer
 * section": the section renders, with text nobody chose.
 *
 * Published under `org` rather than a namespace of its own because it is the
 * same block, on the same page, drawn from the same settings row as the contact
 * lines beside it. `is_enabled: false` withholds the text and the block then
 * omits it, which is what turning it off has to mean.
 */
/**
 * A stored disclaimer, safe to bind into a block that does not preserve breaks.
 *
 * ## Why a bound value may not carry raw newlines
 *
 * WeasyPrint refuses them. A text node containing `\n` under `white-space:
 * normal` fails the render outright:
 *
 *     render_failed: Got ' \n' between two lines.
 *                    Expected nothing or a preserved line break
 *
 * That is not a warning and not a degraded page — it is a 500, and the document
 * does not exist. The stored `professional_disclaimer` is ~1,400 characters
 * typed into a textarea, so it is full of them: single newlines where the
 * author wrapped a line, blank lines where they meant a paragraph.
 *
 * `org.disclaimer` is bound by 543 templates and this module cannot know what
 * `white-space` each one sets. So the value it publishes is safe under all of
 * them: **soft wraps become spaces, paragraph breaks become a single `\n\n`**,
 * which `disclaimer.html.ts` preserves (it sets `pre-wrap`) and which a block
 * that does not preserve breaks renders as ordinary spacing rather than
 * refusing to render at all.
 *
 * The alternative — collapsing everything to one line — is safe too and throws
 * away nine paragraphs the firm wrote. This keeps the structure where it can be
 * kept and never bets the whole document on it.
 */
function normaliseParagraphs(text: string | undefined): string | undefined {
  if (!text) return undefined;
  // A sentinel, because the paragraph break has to survive the step that eats
  // every other newline. NUL cannot appear in a Postgres text column.
  const PARA = '\u0000';
  const out = text
    .replace(/\r\n?/g, '\n')
    // A blank line is a paragraph break; mark it before soft wraps are eaten.
    .replace(/\n[ \t]*\n\s*/g, PARA)
    // Everything left is a soft wrap or a run of spaces: one space.
    .replace(/[ \t\n]+/g, ' ')
    .split(PARA)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .join('\n\n')
    .trim();
  return out || undefined;
}

export interface ReportSettingsLike {
  contact?: Record<string, unknown> | null;
  disclaimer?: Record<string, unknown> | null;
}

export function projectReportSettings(settings: ReportSettingsLike | null | undefined): Record<string, unknown> {
  const org: Record<string, unknown> = {};
  if (!settings) return org;
  const contact = settings.contact ?? null;
  if (contact) {
    put(org, 'abn', str(contact.abn));
    put(org, 'address', str(contact.address));
    put(org, 'name', str(contact.company_name));
    put(org, 'phone', str(contact.phone));
    put(org, 'email', str(contact.email));
    put(org, 'website', str(contact.website));
  }
  const disclaimer = settings.disclaimer ?? null;
  if (disclaimer && disclaimer.is_enabled !== false) {
    put(org, 'disclaimer', normaliseParagraphs(str(disclaimer.text)));
    // 'small' | 'medium' | 'large' — the disclaimer block's own vocabulary,
    // passed through rather than converted to points here, so the block stays
    // the one place that decides what each means.
    put(org, 'disclaimerFontSize', str(disclaimer.font_size));
  }
  return org;
}

/**
 * Merge the organisation into a binding-context `data` object.
 *
 * Additive and non-clobbering: a caller that already set `org` — the converter
 * passes a brand snapshot — keeps what it set, because a **stored** brand is
 * what an issued document was typeset under and the live settings row may have
 * moved since.
 */
/**
 * The brand marks a document may paint, already inlined.
 *
 * Both are `data:` URIs by the time they reach here. This module is pure and
 * does not fetch; `adapters/organisation.ts` reads the bytes, and
 * `reportDesign/assets.pure.ts` decides whether they may be used at all.
 *
 * Two, not one, because the mark is never auto-inverted: it is a gold gradient,
 * and inverting it produces a muddy blue. `mark` is the lockup for ivory paper
 * and `markMono` the one for an obsidian ground, and a cover binds whichever
 * its own ground calls for.
 */
export interface BrandMarks {
  mark?: string | null;
  markMono?: string | null;
}

export function applyOrganisationProjection(
  data: Record<string, any>,
  row: OrganisationRowLike | null | undefined,
  marks?: BrandMarks | null,
  settings?: ReportSettingsLike | null,
): Record<string, any> {
  // `contact_details` wins over the email-signature columns where both carry a
  // field. It is the row the Report Settings page writes for exactly this
  // purpose, whereas the signature columns are an email's footer that this
  // module borrows — see the note above on why they are read one at a time.
  const org = { ...projectOrganisation(row), ...projectReportSettings(settings) };
  /*
   * Published only when the bytes exist.
   *
   * A tenant who has uploaded no mark gets **no mark, not ours** — the house
   * monogram belongs to the deployment that is NPC and travels through
   * `logo_config` like any other, rather than being baked into a shared
   * template. An empty string here would be worse than nothing: an image block
   * conditional on `org.mark` would draw an empty frame instead of dropping out.
   */
  put(org, 'mark', str(marks?.mark));
  put(org, 'markMono', str(marks?.markMono));
  if (!Object.keys(org).length) return data;
  const existing = data.org && typeof data.org === 'object' && !Array.isArray(data.org)
    ? data.org as Record<string, unknown>
    : {};
  data.org = { ...org, ...existing };
  return data;
}
