/**
 * Generated Reports' Commercial & Industrial tab.
 *
 * The format was never in this library at all (G1). These pin what the tab
 * says in each state — reading, failed, empty, populated — that a document
 * names the assessment and the client it was drawn for, and that it opens the
 * assessment it came from.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { CommercialDocumentsLibrary } from '../useCommercialDocumentsLibrary';

const navigate = vi.fn();
vi.mock('react-router-dom', async () => ({
  ...(await vi.importActual<typeof import('react-router-dom')>('react-router-dom')),
  useNavigate: () => navigate,
}));
vi.mock('@/lib/ciAssessment/documentDownload', () => ({ downloadIssuedDocument: vi.fn() }));

const { CommercialDocumentsPanel } = await import('../CommercialDocumentsPanel');
const { ReportLibraryTabs } = await import('../ReportLibraryTabs');
const { Tabs } = await import('@/components/ui/tabs');

const DOC = {
  ledger: 'capacity_report' as const, id: 'r1', assessmentId: 'a1', state: 'ready' as const,
  fileName: 'Commercial_Capacity_Report_CI_202609_K7Q2M_2026-09-23.pdf', createdAt: '2026-09-23T09:00:00Z',
  pageCount: 9, bytes: 120_000, hasAnalysis: true, analysisNote: null, templateName: null,
  error: null, clientId: 'c1', downloadable: true,
  assessmentReference: 'CI-202609-K7Q2M', assessmentTitle: 'G12/25 Solent Circuit',
};

function source(over: Partial<CommercialDocumentsLibrary> = {}): CommercialDocumentsLibrary {
  return {
    library: { documents: [DOC], clients: [{ id: 'c1', primary_first_name: 'Marcus', primary_surname: 'Chen' }] },
    loading: false, error: null, reload: vi.fn(), ...over,
  };
}

function renderPanel(value: CommercialDocumentsLibrary) {
  return render(<MemoryRouter><CommercialDocumentsPanel source={value} /></MemoryRouter>);
}

afterEach(() => { cleanup(); navigate.mockReset(); });

describe('the Commercial & Industrial tab', () => {
  it('names the assessment and the client each report was drawn for', () => {
    renderPanel(source());
    expect(screen.getByText(DOC.fileName)).toBeInTheDocument();
    expect(screen.getByText('G12/25 Solent Circuit · CI-202609-K7Q2M · for Marcus Chen')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `Download ${DOC.fileName}` })).toBeInTheDocument();
  });

  it('opens the assessment a report came from', () => {
    renderPanel(source());
    fireEvent.click(screen.getByRole('button', { name: /open the assessment g12\/25 solent circuit/i }));
    expect(navigate).toHaveBeenCalledWith('/commercial/assessments/a1?step=results');
  });

  it('names no client it may no longer show', () => {
    renderPanel(source({ library: { documents: [DOC], clients: [] } }));
    expect(screen.getByText('G12/25 Solent Circuit · CI-202609-K7Q2M')).toBeInTheDocument();
  });

  it('says what to do when there is nothing yet', () => {
    renderPanel(source({ library: { documents: [], clients: [] } }));
    expect(screen.getByText(/no commercial & industrial reports yet/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /open commercial & industrial/i }));
    expect(navigate).toHaveBeenCalledWith('/commercial');
  });

  it('shows a failed read as a failure, with a retry', () => {
    const value = source({ library: null, error: 'Assessment request failed' });
    renderPanel(value);
    expect(screen.getByRole('alert')).toHaveTextContent('Assessment request failed');
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(value.reload).toHaveBeenCalled();
  });
});

describe('the library tabs', () => {
  function renderTabs(showCommercial: boolean) {
    return render(
      <Tabs value="investment">
        <ReportLibraryTabs isMobile={false} investmentCount={3} comparisonCount={0} showComparisons={false}
          commercialCount={2} showCommercial={showCommercial} />
      </Tabs>,
    );
  }

  it('offers the Commercial & Industrial tab only with the module', () => {
    renderTabs(false);
    expect(screen.queryByRole('tab', { name: /commercial & industrial/i })).toBeNull();
    cleanup();
    renderTabs(true);
    expect(screen.getByRole('tab', { name: /commercial & industrial/i })).toHaveTextContent('2');
  });

  /*
   * On a phone the tabs are a strip that scrolls sideways, and Commercial &
   * Industrial is the third card: opened by a link, it started out of view.
   * jsdom has no layout, so the strip and the open card are given boxes.
   */
  describe('the open tab on a phone', () => {
    let activeBox = { left: 0, right: 0 };
    const scrolled = new WeakMap<Element, number>();
    const scrollIntoView = vi.fn();

    beforeEach(() => {
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
        const box = this.getAttribute('data-state') === 'active' && this.getAttribute('role') === 'tab'
          ? activeBox
          : { left: 0, right: 390 };
        return { ...box, top: 0, bottom: 100, width: box.right - box.left, height: 100, x: box.left, y: 0, toJSON: () => box } as DOMRect;
      });
      Object.defineProperty(HTMLElement.prototype, 'scrollLeft', {
        configurable: true,
        get(this: Element) { return scrolled.get(this) ?? 0; },
        set(this: Element, value: number) { scrolled.set(this, value); },
      });
      Element.prototype.scrollIntoView = scrollIntoView;
    });

    afterEach(() => {
      vi.restoreAllMocks();
      delete (HTMLElement.prototype as { scrollLeft?: number }).scrollLeft;
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
      scrollIntoView.mockReset();
    });

    function renderStrip(isMobile: boolean) {
      const view = render(
        <Tabs value="commercial">
          <ReportLibraryTabs isMobile={isMobile} investmentCount={3} comparisonCount={1}
            commercialCount={2} showCommercial activeTab="commercial" />
        </Tabs>,
      );
      // The strip is the scroller around the tab list's frame — not the tab
      // list, whose own base style also scrolls.
      const strip = view.container.querySelector('[role="tablist"]')?.parentElement?.closest('.overflow-x-auto');
      if (!(strip instanceof HTMLElement)) throw new Error('the tab strip was not rendered');
      return strip;
    }

    it('brings it into view by scrolling the strip, never the page', () => {
      activeBox = { left: 758, right: 1126 };
      const strip = renderStrip(true);
      // Its start lands on the strip's own 16px inset, where its title is.
      expect(strip.scrollLeft).toBe(742);
      expect(scrollIntoView).not.toHaveBeenCalled();
    });

    it('leaves the strip alone when the open tab is already in view', () => {
      activeBox = { left: 16, right: 304 };
      expect(renderStrip(true).scrollLeft).toBe(0);
    });

    it('does nothing on a wider screen, where the tabs are not a strip', () => {
      activeBox = { left: 758, right: 1126 };
      expect(renderStrip(false).scrollLeft).toBe(0);
    });
  });
});
