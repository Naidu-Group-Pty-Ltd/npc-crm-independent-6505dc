/**
 * The Cash Flow module is a drill-down now, and this file pins the three
 * things that made it one.
 *
 * The workspace used to be a dialog opened over the property list, which made
 * the deepest surface in the module the one with no address, no history entry
 * and no route back. It is the same component — one implementation of ten
 * years of projections, overrides, comparison and export — asked for a
 * different frame. That is the first contract here: the frame is a prop, and
 * the page frame renders *outside* a Radix dialog, where `DialogTitle` throws.
 *
 * The second is the return trip. Both actions on a card leave the page, so
 * coming back has to land where the adviser left rather than at the top of a
 * freshly filtered list — filters, pagination depth and scroll offset are
 * written to session state on the way out.
 *
 * The third is that the origin travels in router state rather than being
 * inferred from history: `navigate(-1)` is a browser step, and it lands
 * somewhere else entirely after a refresh, a deep link or a new tab.
 */
import { readFileSync } from 'node:fs';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Dialog } from '@/components/ui/dialog';
import { CashFlowCommandHeader } from '@/components/cash-flow/modal/CashFlowCommandHeader';
import { CashFlowPresentationShell } from '@/components/cash-flow/modal/CashFlowPresentationShell';
import {
  MAX_RESTORED_PAGES,
  readCashFlowListState,
  saveCashFlowListState,
  clearCashFlowListState,
} from '@/components/cash-flow/cashFlowListState';
import {
  CASH_FLOW_ANALYSIS_BACK_LABEL,
  CASH_FLOW_ANALYSIS_ORIGIN,
  CASH_FLOW_ANALYSIS_PATH,
  cameFromCashFlowAnalysis,
  navigateBackToCashFlowAnalysis,
} from '@/lib/navigation/cashFlowOrigin';

const headerProps = {
  propertyAddress: '28 Bligh Street, Muswellbrook NSW 2333',
  isNewBuild: false,
  hasChanges: false,
  hasOverrides: false,
  isSaving: false,
  comparisonMode: false,
  comparisonCount: 1,
  onResetAll: () => {},
  onSaveChanges: () => {},
  exportMenu: null,
};

describe('the workspace header', () => {
  it('renders the page frame outside a dialog, where the dialog frame cannot', () => {
    // The reason the header is polymorphic at all: Radix reads the dialog
    // context in `DialogTitle`/`DialogDescription` and throws without one.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<CashFlowCommandHeader {...headerProps} />)).toThrow();
    consoleError.mockRestore();

    render(
      <CashFlowCommandHeader
        {...headerProps}
        presentation="page"
        onBack={() => {}}
        backLabel={CASH_FLOW_ANALYSIS_BACK_LABEL}
      />,
    );

    expect(screen.getByRole('heading', { name: /10-Year Cash Flow Analysis/i })).toBeTruthy();
    expect(screen.getByText(headerProps.propertyAddress)).toBeTruthy();
  });

  it('offers the named route back, and calls it', () => {
    const onBack = vi.fn();
    render(
      <CashFlowCommandHeader
        {...headerProps}
        presentation="page"
        onBack={onBack}
        backLabel={CASH_FLOW_ANALYSIS_BACK_LABEL}
      />,
    );

    const back = screen.getByRole('button', { name: CASH_FLOW_ANALYSIS_BACK_LABEL });
    fireEvent.click(back);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('keeps the header free of a back control in dialog presentation', () => {
    // The dialog already has its own dismissal; a second one would crowd the
    // Save Changes / Export / More row this header is built around.
    render(
      <Dialog open>
        <CashFlowCommandHeader {...headerProps} />
      </Dialog>,
    );
    expect(screen.queryByRole('button', { name: CASH_FLOW_ANALYSIS_BACK_LABEL })).toBeNull();
  });
});

describe('the presentation shell', () => {
  it('draws the page frame with no dialog around it', () => {
    render(
      <CashFlowPresentationShell
        presentation="page"
        isOpen
        onClose={() => {}}
        header={<div>header</div>}
        footer={<div>footer</div>}
      >
        <div>ten years</div>
      </CashFlowPresentationShell>,
    );

    expect(screen.getByText('ten years')).toBeTruthy();
    expect(screen.getByText('footer')).toBeTruthy();
    // A dialog would have put this behind a modal role and an overlay.
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('the list state a drill-down leaves behind', () => {
  beforeEach(() => clearCashFlowListState());

  it('round-trips filters, pagination depth and scroll offset', () => {
    saveCashFlowListState({
      searchQuery: 'Muswellbrook',
      buildTypeFilter: 'new_build',
      dateRange: '365',
      loadedPages: 3,
      scrollTop: 1840,
    });

    expect(readCashFlowListState()).toEqual({
      searchQuery: 'Muswellbrook',
      buildTypeFilter: 'new_build',
      dateRange: '365',
      loadedPages: 3,
      scrollTop: 1840,
    });
  });

  it('discards a stored filter it does not recognise rather than applying it', () => {
    // A filter value the list cannot match hides every property, and the
    // adviser has no way to see why — the safe reading is "no filter".
    window.sessionStorage.setItem(
      'npc:cash-flow-analysis:list-state:v1',
      JSON.stringify({ searchQuery: 7, buildTypeFilter: 'penthouse', dateRange: 'forever', loadedPages: 0, scrollTop: -5 }),
    );

    expect(readCashFlowListState()).toEqual({
      searchQuery: '',
      buildTypeFilter: 'all',
      dateRange: '30',
      loadedPages: 1,
      scrollTop: 0,
    });
  });

  it('caps how deep a return trip refetches', () => {
    saveCashFlowListState({
      searchQuery: '',
      buildTypeFilter: 'all',
      dateRange: '30',
      loadedPages: 99,
      scrollTop: 0,
    });
    expect(readCashFlowListState()?.loadedPages).toBe(MAX_RESTORED_PAGES);
  });

  it('survives a storage that refuses to answer', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(readCashFlowListState()).toBeNull();
    getItem.mockRestore();
  });
});

describe('the origin marker', () => {
  it('recognises a drill-down and nothing else', () => {
    expect(cameFromCashFlowAnalysis({ state: { from: CASH_FLOW_ANALYSIS_ORIGIN } })).toBe(true);
    expect(cameFromCashFlowAnalysis({ state: { from: 'generated-reports' } })).toBe(false);
    expect(cameFromCashFlowAnalysis({ state: null })).toBe(false);
    expect(cameFromCashFlowAnalysis({ state: undefined })).toBe(false);
  });

  it('pops the drill-down rather than pushing the list a second time', () => {
    // Pushing would leave the list twice in the stack, and the browser's own
    // back button would then walk *forward* into the page just left.
    const navigate = vi.fn();
    navigateBackToCashFlowAnalysis(navigate, { state: { from: CASH_FLOW_ANALYSIS_ORIGIN } });
    expect(navigate).toHaveBeenCalledWith(-1);
  });

  it('addresses the list by path when there is nothing behind this entry', () => {
    // A deep link, a bookmark, a new tab, an activity-log link: -1 would leave
    // the app or land somewhere unrelated.
    const navigate = vi.fn();
    navigateBackToCashFlowAnalysis(navigate, { state: null });
    expect(navigate).toHaveBeenCalledWith(CASH_FLOW_ANALYSIS_PATH);
  });
});

describe('the routes', () => {
  const app = readFileSync('src/App.tsx', 'utf8');
  const list = readFileSync('src/pages/CashFlowAnalysis.tsx', 'utf8');
  const detail = readFileSync('src/pages/CashFlowAnalysisDetail.tsx', 'utf8');
  const reportView = readFileSync('src/pages/InvestmentReportView.tsx', 'utf8');

  it('give the workspace an address of its own, behind the same module guard', () => {
    expect(app).toContain('path="cash-flow-analysis/:id"');
    expect(app).toMatch(/path="cash-flow-analysis\/:id"[^\n]*moduleKey="cash_flow"/);
  });

  it('leave no overlay on the property list', () => {
    // The list opening the workspace itself is exactly what this replaced.
    expect(list).not.toContain('CashFlowAnalysisModal');
    expect(list).toContain('/cash-flow-analysis/${report.id}');
    expect(list).toContain('/investment-report/${report.id}');
  });

  it('forward the legacy ?reportId deep link without leaving a history entry', () => {
    // Landing on the query-string URL and pressing back must not bounce the
    // adviser straight forward into the report again.
    expect(list).toMatch(/navigate\(`\/cash-flow-analysis\/\$\{reportId\}`, \{ replace: true \}\)/);
  });

  it('ask the workspace for its page frame', () => {
    expect(detail).toContain('presentation="page"');
    expect(detail).toContain('CASH_FLOW_ANALYSIS_BACK_LABEL');
  });

  it('name the way back out of a report opened from the list', () => {
    expect(reportView).toContain('cameFromCashFlowAnalysis(location)');
    expect(reportView).toContain('navigateBackToCashFlowAnalysis(navigate, location)');
    expect(reportView).toContain('backLabel={fromCashFlowAnalysis ? CASH_FLOW_ANALYSIS_BACK_LABEL : undefined}');
    expect(CASH_FLOW_ANALYSIS_PATH).toBe('/cash-flow-analysis');
  });

  it('do not let the report claim to be the list it links to', () => {
    // The report's own Cash Flow action is not a drill-down from the list. If
    // it marked itself as one, the workspace's "Back to Cash Flow Analysis"
    // would pop back to the report — a button that does not do what it says.
    const cashFlowActions = reportView.match(/onCashFlow=\{[^}]*\}/g) ?? [];
    expect(cashFlowActions.length).toBeGreaterThan(0);
    for (const action of cashFlowActions) {
      expect(action).not.toContain('CASH_FLOW_ANALYSIS_ORIGIN');
    }
  });
});
