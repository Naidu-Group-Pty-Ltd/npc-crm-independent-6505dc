/**
 * Project a normalised `ClientDetails` payload into the binding vocabulary a
 * Client Details template uses.
 *
 * ## It restates, and normalises nothing
 *
 * Like the Property Comparison before it, this format already has a normaliser
 * — `_shared/reports/clientDetails/normalise.pure.ts`, feeding
 * `render-client-details-pdf`. Every hard question about this record is
 * answered there once: which of nine tables a figure comes from, that stored
 * aggregates are never read, that frequencies are converted through one
 * function, that council and water rates are annual despite their `monthly_`
 * prefix, and that no emoji reaches a page whose faces have no coverage for it.
 *
 * So this takes the payload and restates it. One reader, two renderers, one
 * answer. `docs/reports/CLIENT_DETAILS.md` is that reader's contract.
 *
 * ## 96% of client records are empty, and the pages are built for that
 *
 * Measured across all 775 clients: **742 have no property, no employment, no
 * asset, no liability and no expense.** Not "few" — 96%. The legacy generator
 * opens on a Properties Overview and follows it with per-property blocks, which
 * for 742 clients is a cover and several pages of empty tables.
 *
 * `hasFinancials` is therefore published as a first-class fact, and the masters
 * make every financial page conditional on it. What a client with nothing
 * recorded gets is a short, finished document that says so — which is the most
 * useful thing this format can put in front of an adviser about to send a
 * record to a broker.
 *
 * ## The row counts are bounded here rather than on the page
 *
 * The family templates are absolutely positioned and cannot paginate — a table
 * that runs long does not spill onto the next page, it prints over whatever
 * follows. So every collection is capped, and every cap is measured:
 *
 * | Collection | Max in the record | Drawn | Clients above the cap |
 * | --- | --- | --- | --- |
 * | Expenses (rows) | **100** | — | grouped, never listed |
 * | Expenses (categories) | 14 | 14 | 0 |
 * | Assets | 18 | 8 | 2 of 20 |
 * | Liabilities | 16 | 8 | 1 of 18 |
 * | Properties | 4 | 4 | 0 |
 * | Employment | 3 | 3 | 0 |
 * | Address history | 18 | 4 | 2 of 18 |
 *
 * **Expenses are grouped, not truncated.** One client records 100 expense rows
 * and the average among the 13 who record any is 39 — no cap short enough to
 * fit a page would leave a useful document. Grouped by category the same client
 * is 14 rows, and a category total is what a broker reads anyway. The counts
 * are published beside the groups so the page can say what it did.
 *
 * Where a cap does bite, `…Count` is published beside `…Shown`, so the page can
 * say so rather than truncating in silence. That is `PORTFOLIO.md`'s F4: the
 * finding against the shipping generator is not that it stops, it is that it
 * stops "with nothing on the page saying so".
 *
 * ## Every `Measure` is unwrapped
 *
 * The payload carries `{ value, unit, precision }` so its own renderer can
 * format a figure with its unit. A template binds a raw number and applies
 * `| currency` or `| percent` itself, so `value` is published and the unit is
 * carried by the column heading. Publishing the object would render
 * `[object Object]` on a client's page.
 */

import type {
  ClientDetails,
  Contact,
  EmploymentRow,
  ExpenseRow,
  AssetRow,
  LiabilityRow,
  PropertyRow,
  AddressPeriod,
} from './reports/clientDetails/payload.pure.ts';
import { formatMeasure } from './reportDesign/measure.pure.ts';

/** What the masters draw, per collection. See the header for the measurements. */
export const CAPS = {
  assets: 8,
  liabilities: 8,
  properties: 4,
  employment: 3,
  addressHistory: 4,
  expenseCategories: 14,
} as const;

interface MeasureLike { value?: unknown }

/** The number inside a `Measure`, or undefined. */
function measure(m: unknown): number | undefined {
  if (m === null || m === undefined) return undefined;
  const v = (m as MeasureLike).value;
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function str(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  return s || undefined;
}

function put(target: Record<string, unknown>, key: string, value: unknown): void {
  if (value !== undefined && value !== null && value !== '') target[key] = value;
}

/** A boolean as a word, because a template prints a value rather than a flag. */
function yesNo(v: unknown): string {
  return v ? 'Yes' : 'No';
}

function projectContact(c: Contact): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  put(out, 'name', str(c.name));
  put(out, 'role', c.role === 'secondary' ? 'Secondary' : 'Primary');
  put(out, 'email', str(c.email));
  put(out, 'mobile', str(c.mobile));
  put(out, 'gender', str(c.gender));
  put(out, 'dateOfBirth', str(c.dateOfBirth));
  return out;
}

function projectEmployment(e: EmploymentRow): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  put(out, 'employer', str(e.employer));
  put(out, 'role', str(e.role));
  put(out, 'employmentType', str(e.employmentType));
  put(out, 'contact', str(String(e.contact)));
  put(out, 'workArrangement', str(e.workArrangement));
  put(out, 'startDate', str(e.startDate));
  put(out, 'current', yesNo(e.isCurrent));
  put(out, 'grossAnnual', measure(e.grossAnnual));
  put(out, 'extrasAnnual', measure(e.extrasAnnual));
  return out;
}

function projectAsset(a: AssetRow): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  put(out, 'type', str(a.type));
  put(out, 'description', str(a.description));
  put(out, 'value', measure(a.value));
  return out;
}

function projectLiability(l: LiabilityRow): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  put(out, 'type', str(l.type));
  put(out, 'provider', str(l.provider));
  put(out, 'balance', measure(l.balance));
  put(out, 'creditLimit', measure(l.creditLimit));
  put(out, 'interestRate', measure(l.interestRate));
  put(out, 'monthlyServicing', measure(l.monthlyServicing));
  // The word, so a page can say a figure is modelled without a footnote marker
  // the reader has to hunt for.
  put(out, 'basis', str(l.basis));
  put(out, 'estimated', yesNo(l.isEstimated));
  return out;
}

/**
 * The holding's particulars in one line — kind, lender, ownership and loan
 * terms, restating the rows the legacy holdings table draws (`render.pure.ts`'s
 * Ownership / Lender / Interest rate / Repayment type, formatted by the same
 * `formatMeasure` its `show()` uses).
 *
 * Composed here rather than bound piecewise so a master cannot strand a
 * separator: an unresolved binding renders as the empty string, and the
 * production client this format was measured against stores `lender_name: null`
 * on all three holdings — a template that binds `{{kind}} · {{lender}} · …`
 * prints "Investment · · rent…" on every one of them.
 */
function holdingStrapline(p: PropertyRow): string | undefined {
  const parts: string[] = [];
  const kind = str(p.kindLabel);
  if (kind) parts.push(kind);
  const lender = str(p.lender);
  if (lender) parts.push(lender);
  if (p.ownershipPercentage) parts.push(`${formatMeasure(p.ownershipPercentage)} ownership`);
  const repayment = str(p.repaymentType);
  const rate = p.interestRate ? formatMeasure(p.interestRate) : undefined;
  if (repayment && rate) parts.push(`${repayment.toLowerCase()} at ${rate}`);
  else if (repayment) parts.push(repayment.toLowerCase());
  else if (rate) parts.push(`interest at ${rate}`);
  return parts.length ? parts.join(' · ') : undefined;
}

function projectProperty(p: PropertyRow): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  put(out, 'kind', str(p.kindLabel));
  put(out, 'address', str(p.address));
  // The per-holding heading, with the legacy's own fallback — `holdingsSection`
  // heads a holding with no stored address "address not recorded" rather than
  // leaving the line blank, and an unresolved binding would leave it blank.
  out.heading = str(p.address) ?? 'Address not recorded';
  put(out, 'strapline', holdingStrapline(p));
  put(out, 'ownershipPercentage', measure(p.ownershipPercentage));
  put(out, 'shortAddress', str(p.shortAddress));
  put(out, 'value', measure(p.value));
  put(out, 'loanRemaining', measure(p.loanRemaining));
  put(out, 'equity', measure(p.equity));
  put(out, 'lvr', measure(p.lvr));
  put(out, 'interestRate', measure(p.interestRate));
  put(out, 'lender', str(p.lender));
  put(out, 'repaymentType', str(p.repaymentType));
  put(out, 'rentMonthly', measure(p.rentMonthly));
  put(out, 'rentWeekly', measure(p.rentWeekly));
  put(out, 'expensesMonthly', measure(p.expensesMonthly));
  put(out, 'netMonthly', measure(p.netMonthly));
  if (p.smsf) {
    const smsf: Record<string, unknown> = {};
    put(smsf, 'fundName', str(p.smsf.fundName));
    put(smsf, 'trusteeName', str(p.smsf.trusteeName));
    put(smsf, 'trusteeType', str(p.smsf.trusteeType));
    put(smsf, 'abn', str(p.smsf.abn));
    put(smsf, 'complianceStatus', str(p.smsf.complianceStatus));
    put(smsf, 'auditorName', str(p.smsf.auditorName));
    if (Object.keys(smsf).length) out.smsf = smsf;
  }
  return out;
}

function projectHistory(h: AddressPeriod): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  put(out, 'address', str(h.address));
  put(out, 'startDate', str(h.startDate));
  put(out, 'endDate', str(h.endDate));
  put(out, 'months', typeof h.months === 'number' ? h.months : undefined);
  put(out, 'livingSituation', str(h.livingSituation));
  put(out, 'current', yesNo(h.isCurrent));
  return out;
}

/**
 * Expenses, by category, largest first.
 *
 * The record's `expense_category` is inconsistently cased — `groceries` beside
 * `Groceries`, `health_insurance` beside `Housing` — which would group as two
 * lines saying the same thing. `humanise()` in the normaliser has already
 * folded them, so grouping on the payload's `category` is safe and grouping on
 * the raw column would not be.
 */
function groupExpenses(rows: readonly ExpenseRow[]): Array<Record<string, unknown>> {
  const byCategory = new Map<string, { monthly: number; count: number; essential: number }>();
  for (const row of rows) {
    const category = str(row.category) ?? 'Other';
    const monthly = measure(row.monthly) ?? 0;
    const entry = byCategory.get(category) ?? { monthly: 0, count: 0, essential: 0 };
    entry.monthly += monthly;
    entry.count += 1;
    if (row.isEssential) entry.essential += 1;
    byCategory.set(category, entry);
  }
  return [...byCategory.entries()]
    .sort((a, b) => b[1].monthly - a[1].monthly)
    .map(([category, e]) => ({
      category,
      monthly: e.monthly,
      lines: e.count,
      // "3 of 4 essential" is what an assessor reads this column for.
      essential: e.essential,
    }));
}

export interface ProjectedClientDetails {
  client: Record<string, unknown>;
  clientDetails: Record<string, unknown>;
  report: Record<string, unknown>;
}

export function projectClientDetails(details: ClientDetails): ProjectedClientDetails {
  const d = details;
  const out: Record<string, unknown> = {};

  put(out, 'narrative', str(d.narrative));
  put(out, 'preparedOn', str(d.meta.preparedOn));
  out.propertyCount = d.meta.propertyCount;
  out.hasSecondaryContact = yesNo(d.meta.hasSecondaryContact);

  // ── who ──────────────────────────────────────────────────────────────────
  const contacts = d.household.contacts.map(projectContact);
  if (contacts.length) out.contacts = contacts;
  put(out, 'maritalStatus', str(d.household.maritalStatus));
  put(out, 'dependents', measure(d.household.dependents));

  // By role, not by position — the normaliser only pushes a residence it can
  // stand behind, so a record whose primary address is empty while the
  // secondary's is not would put the secondary at index 0.
  const residenceByRole = new Map(d.household.residences.map((entry) => [entry.contact, entry]));
  const primaryResidence = residenceByRole.get('primary')?.residence;
  if (primaryResidence) {
    const r: Record<string, unknown> = {};
    put(r, 'address', str(primaryResidence.address));
    put(r, 'suburb', str(primaryResidence.suburb));
    put(r, 'state', str(primaryResidence.state));
    put(r, 'postcode', str(primaryResidence.postcode));
    put(r, 'country', str(primaryResidence.country));
    put(r, 'livingSituation', str(primaryResidence.livingSituation));
    put(r, 'residentialStatus', str(primaryResidence.residentialStatus));
    if (Object.keys(r).length) out.residence = r;
  }

  /**
   * The second contact's residence, which the legacy contact block draws and
   * this projection used to drop entirely.
   *
   * Two shapes, restating `render.pure.ts`'s `contactBlock` exactly: a
   * secondary who shares gets the sentence ("Lives at the same address as the
   * primary contact."), a secondary who lives apart gets their own address
   * composed the way the legacy composes it — address, suburb, state postcode,
   * country, joined and trimmed. `line` is the one path a definitions row
   * binds; the parts are published beside it. Production holds one of each
   * shape across the 13 records with a second contact.
   */
  const secondaryEntry = residenceByRole.get('secondary');
  if (secondaryEntry) {
    const s: Record<string, unknown> = {};
    s.sharedWithPrimary = yesNo(secondaryEntry.sharedWithPrimary);
    if (secondaryEntry.sharedWithPrimary) {
      s.line = 'Lives at the same address as the primary contact.';
    } else {
      const r = secondaryEntry.residence;
      const address = [r.address, r.suburb, `${r.state} ${r.postcode}`.trim(), r.country]
        .map((x) => (typeof x === 'string' ? x.trim() : ''))
        .filter(Boolean)
        .join(', ');
      put(s, 'address', str(r.address));
      put(s, 'suburb', str(r.suburb));
      put(s, 'state', str(r.state));
      put(s, 'postcode', str(r.postcode));
      put(s, 'livingSituation', str(r.livingSituation));
      put(s, 'residentialStatus', str(r.residentialStatus));
      // The normaliser only keeps a residence with something in it, so this
      // line is never empty when the entry exists.
      put(s, 'line', [address, str(r.livingSituation), str(r.residentialStatus)]
        .filter(Boolean).join(' · '));
    }
    out.secondaryResidence = s;
  }

  const history = d.household.history;
  if (history.length) {
    out.addressHistory = history.slice(0, CAPS.addressHistory).map(projectHistory);
    out.addressHistoryShown = Math.min(history.length, CAPS.addressHistory);
    out.addressHistoryCount = history.length;
  }

  // ── work and income ──────────────────────────────────────────────────────
  if (d.employment.length) {
    out.employment = d.employment.slice(0, CAPS.employment).map(projectEmployment);
    out.employmentShown = Math.min(d.employment.length, CAPS.employment);
    out.employmentCount = d.employment.length;
  }

  const income: Record<string, unknown> = {};
  put(income, 'employmentMonthly', measure(d.income.totalEmploymentMonthly));
  put(income, 'primaryEmploymentMonthly', measure(d.income.primaryEmploymentMonthly));
  put(income, 'secondaryEmploymentMonthly', measure(d.income.secondaryEmploymentMonthly));
  put(income, 'otherMonthly', measure(d.income.totalOtherMonthly));
  put(income, 'rentalMonthly', measure(d.income.rentalMonthly));
  put(income, 'totalMonthly', measure(d.income.totalMonthly));
  put(income, 'totalGrossAnnual', measure(d.income.totalGrossAnnual));
  if (Object.keys(income).length) out.income = income;

  const otherIncome = d.income.otherIncome.map((line) => {
    const o: Record<string, unknown> = {};
    put(o, 'label', str(line.label));
    put(o, 'monthly', measure(line.monthly));
    return o;
  });
  if (otherIncome.length) out.otherIncome = otherIncome;

  // ── what they own and owe ────────────────────────────────────────────────
  if (d.assets.length) {
    out.assets = d.assets.slice(0, CAPS.assets).map(projectAsset);
    out.assetsShown = Math.min(d.assets.length, CAPS.assets);
    out.assetCount = d.assets.length;
  }
  if (d.liabilities.length) {
    out.liabilities = d.liabilities.slice(0, CAPS.liabilities).map(projectLiability);
    out.liabilitiesShown = Math.min(d.liabilities.length, CAPS.liabilities);
    out.liabilityCount = d.liabilities.length;
    out.liabilitiesIncludeEstimates = yesNo(d.liabilitiesIncludeEstimates);
  }

  // ── what they spend ──────────────────────────────────────────────────────
  if (d.expenses.length) {
    const groups = groupExpenses(d.expenses);
    out.expenseGroups = groups.slice(0, CAPS.expenseCategories);
    out.expenseCategoryCount = groups.length;
    out.expenseLineCount = d.expenses.length;
    out.expenseMonthly = groups.reduce((t, g) => t + (g.monthly as number), 0);
  }

  // ── property ─────────────────────────────────────────────────────────────
  if (d.ownerOccupied) out.ownerOccupied = projectProperty(d.ownerOccupied);
  if (d.properties.length) {
    out.properties = d.properties.slice(0, CAPS.properties).map(projectProperty);
    out.propertiesShown = Math.min(d.properties.length, CAPS.properties);
  }

  // ── where they stand ─────────────────────────────────────────────────────
  const p = d.position;
  const position: Record<string, unknown> = {};
  put(position, 'propertyValue', measure(p.propertyValue));
  put(position, 'propertyDebt', measure(p.propertyDebt));
  put(position, 'propertyEquity', measure(p.propertyEquity));
  put(position, 'otherAssets', measure(p.otherAssets));
  put(position, 'otherLiabilities', measure(p.otherLiabilities));
  put(position, 'netWorth', measure(p.netWorth));
  put(position, 'incomeMonthly', measure(p.incomeMonthly));
  put(position, 'commitmentsMonthly', measure(p.commitmentsMonthly));
  put(position, 'surplusMonthly', measure(p.surplusMonthly));
  put(position, 'commitmentRatio', measure(p.commitmentRatio));
  if (Object.keys(position).length) out.position = position;

  /**
   * Whether the record holds anything financial at all.
   *
   * 742 of the 775 clients answer no. Every financial page in the catalogue is
   * conditional on this, and the closing page prints the sentence that says the
   * document is complete and the record is not.
   *
   * Deliberately not `position.netWorth > 0`: a client can hold a property
   * worth exactly what is owed on it, and a client with only liabilities has a
   * negative net worth and a great deal recorded.
   */
  out.hasFinancials = d.employment.length > 0
    || d.assets.length > 0
    || d.liabilities.length > 0
    || d.expenses.length > 0
    || d.properties.length > 0
    || d.ownerOccupied !== null;

  const client: Record<string, unknown> = {};
  // The one migrated format whose source table genuinely carries a client.
  put(client, 'name', str(d.meta.clientName));

  const report: Record<string, unknown> = {};
  put(report, 'generatedDate', str(d.meta.preparedOn));

  return { client, clientDetails: out, report };
}

/**
 * Merge the projection into a binding-context `data` object.
 *
 * `clientDetails` rather than `client`: `assets`, `liabilities`, `expenses`,
 * `properties`, `income` and `position` all mean other things to the other five
 * formats in the one shared preview sample, and `client` is the ambient
 * namespace every format's cover uses for a name.
 */
export function applyClientDetailsProjection(
  data: Record<string, any>,
  details: ClientDetails,
): Record<string, any> {
  const p = projectClientDetails(details);
  const merge = (key: string, extra: Record<string, unknown>) => {
    if (!Object.keys(extra).length) return;
    const existing = data[key];
    data[key] = {
      ...(existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {}),
      ...extra,
    };
  };
  merge('client', p.client);
  merge('clientDetails', p.clientDetails);
  merge('report', p.report);
  return data;
}
