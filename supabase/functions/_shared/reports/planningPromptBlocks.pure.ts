/**
 * Compose the Planning & Development statistics blocks for the generator
 * prompt from what `planning-data-service` measured — and only that.
 *
 * The rules these blocks enforce come from the zoning research doc and §24:
 *
 *  - **The verbatim zone code leads; the family never impersonates it.**
 *    `R1` and `UGZ8` are different legal systems, so the national family is
 *    rendered only as a parenthetical reading beside the instrument's own
 *    words, and a zone with no derivable family simply has none.
 *  - **Surveyed and computed areas are different claims** and are labelled.
 *  - **Every absent cell renders its reason** — WA's licence bar, QLD's
 *    per-council zoning, an unreachable register — because "no zoning
 *    shown" must never be readable as "no zoning exists".
 *  - **A sample says it is one.** DA aggregates over fewer rows than the
 *    register's own total are labelled with both numbers.
 *  - Law 2 throughout: a labelled row is a promise a figure follows it.
 */

interface CellBase { status?: unknown; note?: unknown }

export interface PlanningPromptInput {
  planningData?: {
    jurisdiction?: unknown;
    zoning?: CellBase & Record<string, unknown>;
    parcel?: CellBase & Record<string, unknown>;
    developmentInstruments?: CellBase & { instruments?: unknown };
    developmentActivity?: CellBase & { summary?: unknown };
    verification?: unknown;
  };
}

const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;
const fmtInt = (v: number) => v.toLocaleString('en-AU');
const fmtMoney = (v: number) => `$${Math.round(v).toLocaleString('en-AU')}`;

const ok = (cell: CellBase | undefined): boolean => cell?.status === 'ok';

/** An absent cell's one-line disclosure — the note the service wrote. */
function absenceLine(label: string, cell: CellBase | undefined): string | null {
  if (!cell || ok(cell)) return null;
  const note = str(cell.note);
  return note ? `${label}: ${note}` : null;
}

export function zoningBlock(input: PlanningPromptInput): string {
  const z = input.planningData?.zoning;
  if (!z || !ok(z)) return '';
  const code = str(z['zoneCode']);
  if (!code) return '';
  const label = str(z['zoneLabel']);
  const rows = [
    `| Zone | **${code}**${label ? ` — ${label}` : ''} |`,
    str(z['instrument']) ? `| Planning instrument | ${str(z['instrument'])} |` : null,
    str(z['lga']) ? `| Local government area | ${str(z['lga'])} |` : null,
    str(z['currencyDate']) ? `| Layer currency date | ${str(z['currencyDate'])} |` : null,
    str(z['source']) ? `| Source | ${str(z['source'])} |` : null,
  ].filter((r): r is string => r !== null);
  const family = str(z['zoneFamily']);
  const familyLine = family
    ? `\nRead from the instrument's own description, this is a ${family} zone — but the zone is **${code}**, and only that code may be stated as the zoning.`
    : '';
  return `**Zoning (from the jurisdiction's own planning layer):**\n\n| | |\n|---|---|\n${rows.join('\n')}${familyLine}`;
}

export function parcelBlock(input: PlanningPromptInput): string {
  const p = input.planningData?.parcel;
  if (!p || !ok(p)) return '';
  const area = num(p['area']);
  const basis = str(p['areaBasis']);
  const rows = [
    str(p['lotPlan']) ? `| Lot/plan | ${str(p['lotPlan'])} |` : null,
    area !== null
      ? `| Land area | ${fmtInt(area)} m² (${basis === 'surveyed' ? 'surveyed figure from the cadastre' : 'computed from boundary geometry — not a surveyed figure'}) |`
      : null,
    str(p['tenure']) ? `| Tenure | ${str(p['tenure'])} |` : null,
    str(p['lga']) ? `| Local government area | ${str(p['lga'])} |` : null,
    str(p['locality']) ? `| Locality | ${str(p['locality'])} |` : null,
    str(p['source']) ? `| Source | ${str(p['source'])} |` : null,
  ].filter((r): r is string => r !== null);
  if (rows.length === 0) return '';
  return `**Parcel (state cadastre):**\n\n| | |\n|---|---|\n${rows.join('\n')}`;
}

export function developmentInstrumentsBlock(input: PlanningPromptInput): string {
  const cell = input.planningData?.developmentInstruments;
  if (!cell) return '';
  if (ok(cell)) {
    const instruments = Array.isArray(cell.instruments) ? cell.instruments : [];
    const KIND_LABEL: Record<string, string> = {
      priority_development_area: 'Priority Development Area',
      state_development_area: 'State Development Area',
      coordinated_project: 'Coordinated Project',
      infrastructure_designation: 'Infrastructure designation',
    };
    const lines = instruments
      .map((i) => {
        const rec = i as Record<string, unknown>;
        const name = str(rec['name']);
        const kind = KIND_LABEL[String(rec['kind'])] ?? null;
        if (!name || !kind) return null;
        const bits = [str(rec['status']), str(rec['gazetted']) ? `gazetted ${str(rec['gazetted'])}` : null]
          .filter((b): b is string => b !== null);
        return `- **${kind}**: ${name}${bits.length ? ` (${bits.join(', ')})` : ''}`;
      })
      .filter((l): l is string => l !== null);
    if (lines.length === 0) return '';
    return `**State development instruments at this property:**\n\n${lines.join('\n')}`;
  }
  if (cell.status === 'none_at_point') {
    const note = str(cell.note);
    return note ? `**State development instruments:** ${note}` : '';
  }
  return '';
}

export function developmentActivityBlock(input: PlanningPromptInput): string {
  const cell = input.planningData?.developmentActivity;
  if (!cell || !ok(cell)) return '';
  const s = (cell.summary ?? {}) as Record<string, unknown>;
  const council = str(s['councilName']);
  const total = num(s['totalInPeriod']);
  const read = num(s['rowsRead']);
  if (!council || total === null || read === null) return '';

  const from = str(s['periodFrom']);
  const to = str(s['periodTo']);
  const sampled = read < total;
  const scope = sampled
    ? `the ${fmtInt(read)} applications read of ${fmtInt(total)} returned by the register`
    : `all ${fmtInt(total)} applications`;

  const parts: string[] = [
    `**Development applications — ${council}** (lodged ${from ?? '?'} to ${to ?? '?'}, NSW Planning Portal Online DA register):`,
    `- Applications lodged in the period: **${fmtInt(total)}**`,
  ];

  const statuses = Array.isArray(s['byStatus']) ? (s['byStatus'] as Array<Record<string, unknown>>) : [];
  const statusBits = statuses
    .map((b) => (str(b['status']) && num(b['count']) !== null ? `${str(b['status'])} ${fmtInt(num(b['count'])!)}` : null))
    .filter((b): b is string => b !== null);
  if (statusBits.length > 0) parts.push(`- Status (of ${scope}): ${statusBits.join(', ')}`);

  /*
   * New proposals and amendments are reported on SEPARATE lines and are never
   * added. A modification restates the development it modifies — the register
   * carries the whole cost and the whole dwelling count on the modification
   * row — so a combined figure counts the same building twice. Measured on
   * this register (The Hills Shire, all 659 applications lodged over six
   * months to 17 Sep 2026): the combined form stated $2.367bn against
   * $1.177bn of new proposals, and 3,447 dwellings against 1,412.
   *
   * The model reads these lines, so the wording carries the distinction: an
   * un-labelled pair of numbers is one a narrative will add up.
   */
  const totals = (key: string) => {
    const v = s[key];
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  };
  const line = (t: Record<string, unknown> | null, label: string, note: string) => {
    if (!t) return;
    const cost = num(t['statedCostTotal']);
    const rowsCost = num(t['rowsWithCost']);
    if (cost !== null && cost > 0 && rowsCost) {
      parts.push(`- ${label} — stated cost: **${fmtMoney(cost)}** across the ${fmtInt(rowsCost)} that stated one (as stated by applicants, not an assessed value). ${note}`);
    }
    const dw = num(t['newDwellingsTotal']);
    const rowsDw = num(t['rowsWithDwellings']);
    if (dw !== null && dw > 0 && rowsDw) {
      parts.push(`- ${label} — new dwellings: **${fmtInt(dw)}** across ${fmtInt(rowsDw)} applications`);
    }
  };
  line(totals('newApplications'), 'New development applications',
    'These are the new proposals.');
  line(totals('amendments'), 'Modifications of approved developments',
    'Each restates the development it modifies, so this figure MUST NOT be added to the one above.');
  line(totals('unclassified'), 'Applications of an unrecognised type',
    'Type not recognised by the classifier; reported separately and not counted as new development.');

  const types = Array.isArray(s['topDevelopmentTypes']) ? (s['topDevelopmentTypes'] as Array<Record<string, unknown>>) : [];
  const typeBits = types
    .map((t) => (str(t['type']) && num(t['count']) !== null ? `${str(t['type'])} (${fmtInt(num(t['count'])!)})` : null))
    .filter((b): b is string => b !== null)
    .slice(0, 6);
  if (typeBits.length > 0) parts.push(`- Most common development types: ${typeBits.join(', ')}`);

  // One line per DEVELOPMENT, not per application. This ranked rows, so on
  // the Kellyville report three of the five largest "projects" were the same
  // Norwest data centre, once for each time it had been modified.
  const largest = Array.isArray(s['largestDevelopments']) ? (s['largestDevelopments'] as Array<Record<string, unknown>>) : [];
  const largestLines = largest
    .map((l) => {
      const cost = num(l['statedCost']);
      if (cost === null) return null;
      const types = Array.isArray(l['types']) ? (l['types'] as unknown[]).map(str).filter((t): t is string => t !== null) : [];
      const amendments = num(l['amendmentsInWindow']) ?? 0;
      const bits = [
        str(l['reference']),
        types.slice(0, 2).join(' / ') || null,
        str(l['address']) ?? str(l['suburb']),
        str(l['status']),
        // So a development that reached this window only through its
        // amendments cannot read as something newly proposed in it.
        l['parentOutsideWindow'] === true ? 'approved before this window opened' : null,
        amendments > 0 ? `amended ${fmtInt(amendments)} time${amendments === 1 ? '' : 's'} in this window` : null,
      ].filter((b): b is string => b !== null);
      return `  - ${fmtMoney(cost)}${bits.length ? ` — ${bits.join(', ')}` : ''}`;
    })
    .filter((l): l is string => l !== null);
  if (largestLines.length > 0) {
    parts.push(
      `- Largest developments by stated cost (one entry per development; a figure is the applicant's own `
      + `stated cost of development and is NOT funding, and this register publishes no delivery date for `
      + `any of them):\n${largestLines.join('\n')}`,
    );
  }

  if (sampled) {
    parts.push(`- Coverage note: aggregate figures above are computed over ${scope}.`);
  }
  return parts.join('\n');
}

/**
 * The whole Planning & Development block for the prompt. One honest line
 * per absent cell; one closing instruction so the model cannot pad the
 * section with zones or projects nothing measured.
 */
export function planningStatBlocks(input: PlanningPromptInput): string {
  const pd = input.planningData;
  if (!pd) {
    return 'No planning lookup is available for this property (no verified coordinate). State that plainly in one sentence if planning is discussed; do not name a zone, and do not invent development activity.';
  }
  const parts = [
    zoningBlock(input),
    parcelBlock(input),
    developmentInstrumentsBlock(input),
    developmentActivityBlock(input),
  ].filter((b) => b !== '');

  const absences = [
    absenceLine('Zoning', pd.zoning),
    absenceLine('Parcel attributes', pd.parcel),
    absenceLine('Development applications', pd.developmentActivity),
  ].filter((l): l is string => l !== null);
  if (absences.length > 0) {
    parts.push(`**Not available for this property, and why:**\n${absences.map((a) => `- ${a}`).join('\n')}`);
  }

  const verification = str(pd.verification);
  if (verification) parts.push(verification);

  parts.push(
    'Discuss only the planning facts above. Do NOT name a zone, overlay, development application or project that does not appear here; do not present the zone family as the zone; a figure marked "stated by applicants" must keep that attribution.',
  );
  return parts.join('\n\n');
}
