/**
 * The "Written for" control on the Publishing & Export panel.
 *
 * The rules it serves are pinned where they live (`reportAudience.spec.ts`,
 * `audienceKpiParity.spec.ts`); this pins the SCREEN, because a rule nobody can
 * reach is a rule nobody applies. Three things, each of which a plausible
 * refactor would break without failing anything else:
 *
 *  1. all three audiences are offered, and the chosen one reads as chosen;
 *  2. pressing the chosen one again changes nothing — Radix clears a single
 *     group on a second press, and a document is always written for somebody;
 *  3. the choice reaches the client-PDF action, which is the one door every
 *     document on this screen leaves by.
 *
 * It sits under `src/lib/reports` rather than beside the component because
 * CI names its vitest paths one by one and `src/components/reports` is not
 * one of them — a test in an unrun folder guards nothing.
 */
import { fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PDF_DESIGN_OPTIONS } from '@/components/reports/premiumPdfDesign';
import {
  AUDIENCE_DESCRIPTION,
  AUDIENCE_LABEL,
  REPORT_AUDIENCES,
  type ReportAudience,
} from '@/lib/reports/investment/audienceContent.pure';

const h = vi.hoisted(() => ({ buttonProps: [] as Array<Record<string, unknown>> }));

// The panel's siblings reach for the network and the session; this screen is
// examined for what it DRAWS and what it HANDS ON, so they stand in as markers.
vi.mock('@/components/reports/PremiumPdfButton', () => ({
  PremiumPdfButton: (props: Record<string, unknown>) => {
    h.buttonProps.push(props);
    return <div>Generate Client PDF</div>;
  },
}));
vi.mock('@/components/reports/RegenerateWithPerplexityButton', () => ({
  RegenerateWithPerplexityButton: () => <div>Regenerate</div>,
}));
vi.mock('@/components/reports/ReportTemplateSelector', () => ({
  ReportTemplateSelector: () => <div>Template</div>,
}));

beforeEach(() => {
  h.buttonProps = [];
});

async function drawPanel(audience: ReportAudience, onAudienceChange = vi.fn()) {
  const { InvestmentReportExportPanel } = await import('@/components/reports/report-view/InvestmentReportExportPanel');
  const screen = render(
    <InvestmentReportExportPanel
      report={{ id: 'r1', property_address: '1 Test St', property_listing_id: null, report_content: '', created_at: '2026-09-23T00:00:00Z' } as never}
      includeSources
      includeScoring
      includeCharts
      includeHeroImages={false}
      includeSparklines
      audience={audience}
      pdfDesignOptions={DEFAULT_PDF_DESIGN_OPTIONS}
      onIncludeSourcesChange={() => {}}
      onIncludeScoringChange={() => {}}
      onIncludeChartsChange={() => {}}
      onIncludeHeroImagesChange={() => {}}
      onIncludeSparklinesChange={() => {}}
      onAudienceChange={onAudienceChange}
      onPdfDesignOptionsChange={() => {}}
      onHeroImagesManage={() => {}}
      onRegenerated={() => {}}
      onDownload={() => {}}
    />,
  );
  return { ...screen, onAudienceChange };
}

/** The group's item for one audience, found by the words a person reads. */
function item(container: HTMLElement, audience: ReportAudience): HTMLElement {
  const group = container.querySelector('[aria-labelledby="report-audience-label"]');
  expect(group, 'the choice is labelled by its heading').not.toBeNull();
  const match = Array.from(group!.querySelectorAll('button'))
    .find((b) => b.textContent?.trim() === AUDIENCE_LABEL[audience]);
  expect(match, AUDIENCE_LABEL[audience]).toBeTruthy();
  return match as HTMLElement;
}

describe('"Written for" on the Publishing & Export panel', () => {
  it('offers all three audiences under one labelled heading', async () => {
    const { container, getByText } = await drawPanel('investor');
    expect(getByText('Written for')).toBeTruthy();
    for (const audience of REPORT_AUDIENCES) item(container, audience);
    const group = container.querySelector('[aria-labelledby="report-audience-label"]')!;
    expect(group.querySelectorAll('button')).toHaveLength(REPORT_AUDIENCES.length);
  });

  it.each(REPORT_AUDIENCES)('shows %s as the chosen one, and says what it does', async (audience) => {
    const { container, getByText } = await drawPanel(audience);
    for (const other of REPORT_AUDIENCES) {
      expect(item(container, other).getAttribute('data-state'), other)
        .toBe(other === audience ? 'on' : 'off');
    }
    expect(getByText(AUDIENCE_DESCRIPTION[audience])).toBeTruthy();
  });

  it('reports a new choice by its stored value', async () => {
    const { container, onAudienceChange } = await drawPanel('investor');
    fireEvent.click(item(container, 'owner_occupier'));
    expect(onAudienceChange).toHaveBeenCalledWith('owner_occupier');
    fireEvent.click(item(container, 'both'));
    expect(onAudienceChange).toHaveBeenLastCalledWith('both');
  });

  it('keeps the choice when the chosen one is pressed again', async () => {
    const { container, onAudienceChange } = await drawPanel('owner_occupier');
    fireEvent.click(item(container, 'owner_occupier'));
    expect(onAudienceChange).not.toHaveBeenCalled();
  });

  it.each(REPORT_AUDIENCES)('hands %s to the client-PDF action', async (audience) => {
    await drawPanel(audience);
    expect(h.buttonProps.length).toBeGreaterThan(0);
    expect(h.buttonProps.at(-1)).toMatchObject({ audience });
  });
});
