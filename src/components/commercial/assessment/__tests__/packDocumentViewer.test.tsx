/**
 * The viewer's contract with the user.
 *
 * Three of these are requirements rather than preferences: the example is
 * read-only, it is never offered as a download, and the frame it renders in
 * cannot execute anything. The rest cover the states a viewer has to get right
 * — loading, failure, and navigating a document that does not fit on screen.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { PackDocumentViewer } from '../PackDocumentViewer';
import type { PackSourceDocument } from '@/lib/ciAssessment/intakePack/sourceDocuments';

const renderWorkbookToHtml = vi.fn();
const renderWordToHtml = vi.fn();
const readSourceDocument = vi.fn();

vi.mock('@/lib/ciAssessment/intakePack/viewer/excelToHtml', () => ({
  renderWorkbookToHtml: (...args: unknown[]) => renderWorkbookToHtml(...args),
}));
vi.mock('@/lib/ciAssessment/intakePack/viewer/wordToHtml', () => ({
  renderWordToHtml: (...args: unknown[]) => renderWordToHtml(...args),
}));
vi.mock('@/lib/ciAssessment/intakePack/sourceDocuments', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ciAssessment/intakePack/sourceDocuments')>();
  return { ...actual, readSourceDocument: (...args: unknown[]) => readSourceDocument(...args) };
});

const WORKBOOK: PackSourceDocument = {
  id: 'workbook-example',
  kind: 'workbook',
  variant: 'example',
  fileName: 'Example.xlsx',
  url: 'data:application/octet-stream;base64,AA==',
  mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  title: 'Completed example — workbook',
};

const GUIDE: PackSourceDocument = {
  ...WORKBOOK,
  id: 'guide-example',
  kind: 'guide',
  fileName: 'Example.docx',
  title: 'Completed example — interview guide',
};

beforeEach(() => {
  readSourceDocument.mockResolvedValue(new ArrayBuffer(8));
  renderWorkbookToHtml.mockResolvedValue({
    sheets: [
      { name: 'Start here', html: '<html><body>start</body></html>', rows: 4, columns: 3, width: 900, height: 700 },
      { name: 'Summary', html: '<html><body>summary</body></html>', rows: 60, columns: 4, width: 1100, height: 1600 },
    ],
  });
  renderWordToHtml.mockResolvedValue({
    html: '<html><body>guide</body></html>',
    pageOffsets: [0, 1141, 2281],
    height: 3400,
    width: 794,
  });
  // jsdom has no layout, so the scrolling the pager and tab strip perform are
  // no-op stubs.
  Element.prototype.scrollTo = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('PackDocumentViewer', () => {
  it('renders the workbook in a frame that cannot execute anything', async () => {
    const { container } = render(
      <PackDocumentViewer document={WORKBOOK} open onOpenChange={() => {}} />,
    );

    const frame = await waitFor(() => {
      const found = container.ownerDocument.querySelector('iframe');
      expect(found).not.toBeNull();
      return found!;
    });

    // An empty sandbox is the restrictive one: no scripts, no forms, no
    // navigation, no same-origin access.
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(frame.getAttribute('srcdoc')).toContain('start');
  });

  it('says it is read-only and offers no way to download it', async () => {
    render(<PackDocumentViewer document={WORKBOOK} open onOpenChange={() => {}} />);
    await screen.findByText('Read-only');

    // The example is deliberately not a file the user can take away.
    expect(screen.queryByRole('button', { name: /download/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /download/i })).toBeNull();
    expect(document.querySelector('a[download]')).toBeNull();
  });

  it('lists the worksheets as a tablist and switches between them', async () => {
    render(<PackDocumentViewer document={WORKBOOK} open onOpenChange={() => {}} />);
    const summaryTab = await screen.findByRole('tab', { name: 'Summary' });

    // A dozen sheets is enough that "tab 2 of 12, selected" is worth saying.
    expect(screen.getByRole('tablist', { name: 'Worksheets' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Start here' })).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(summaryTab);
    await waitFor(() => {
      expect(document.querySelector('iframe')?.getAttribute('srcdoc')).toContain('summary');
    });
    expect(summaryTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'ci-pack-tab-1');
  });

  it('moves between worksheets with the arrow keys', async () => {
    render(<PackDocumentViewer document={WORKBOOK} open onOpenChange={() => {}} />);
    const first = await screen.findByRole('tab', { name: 'Start here' });

    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Summary' })).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(first, { key: 'Home' });
    expect(first).toHaveAttribute('aria-selected', 'true');
  });

  it('keeps the strip to a single tab stop', async () => {
    // Roving tabindex: tabbing past the strip should not walk twelve sheets.
    render(<PackDocumentViewer document={WORKBOOK} open onOpenChange={() => {}} />);
    await screen.findByRole('tab', { name: 'Start here' });

    const reachable = screen.getAllByRole('tab').filter(
      (tab) => tab.getAttribute('tabindex') === '0',
    );
    expect(reachable).toHaveLength(1);
    expect(reachable[0]).toHaveAccessibleName('Start here');
  });

  it('pages through a Word document', async () => {
    render(<PackDocumentViewer document={GUIDE} open onOpenChange={() => {}} />);
    await screen.findByText('Page 1 of 3');

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(await screen.findByText('Page 2 of 3')).toBeInTheDocument();

    // The frame is sized to the whole document; the container is what scrolls.
    expect(document.querySelector('iframe')?.style.height).toBe('3400px');
  });

  it('zooms in and out within bounds', async () => {
    render(<PackDocumentViewer document={WORKBOOK} open onOpenChange={() => {}} />);
    // Workbooks open one step down so a wide sheet fits without side-scrolling.
    await screen.findByText('80%');

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(screen.getByText('100%')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(screen.getByText('65%')).toBeInTheDocument();
  });


  it('offers a full-screen toggle', async () => {
    render(<PackDocumentViewer document={WORKBOOK} open onOpenChange={() => {}} />);
    const expand = await screen.findByRole('button', { name: 'Expand to full screen' });
    fireEvent.click(expand);
    expect(screen.getByRole('button', { name: 'Exit full screen' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows a loading state while the document is being read', async () => {
    let release!: (value: ArrayBuffer) => void;
    readSourceDocument.mockReturnValue(new Promise<ArrayBuffer>((resolve) => { release = resolve; }));

    render(<PackDocumentViewer document={WORKBOOK} open onOpenChange={() => {}} />);
    expect(await screen.findByText('Opening the example…')).toBeInTheDocument();

    release(new ArrayBuffer(8));
    await waitFor(() => expect(screen.queryByText('Opening the example…')).toBeNull());
  });

  it('explains a failure and offers a retry rather than showing a blank frame', async () => {
    renderWorkbookToHtml.mockRejectedValueOnce(new Error('The workbook is corrupt.'));

    render(<PackDocumentViewer document={WORKBOOK} open onOpenChange={() => {}} />);
    expect(await screen.findByText('This example could not be opened')).toBeInTheDocument();
    expect(screen.getByText('The workbook is corrupt.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    await waitFor(() => expect(document.querySelector('iframe')).not.toBeNull());
  });

  it('does nothing at all until it is opened', () => {
    render(<PackDocumentViewer document={WORKBOOK} open={false} onOpenChange={() => {}} />);
    expect(readSourceDocument).not.toHaveBeenCalled();
  });
});
