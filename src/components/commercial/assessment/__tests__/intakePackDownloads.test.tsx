/**
 * The blank templates, and who may take one.
 *
 * The defect this pins: the download buttons were disabled along with the rest
 * of the panel whenever the assessment was read-only — which is every
 * completed and linked assessment — so the templates quietly became
 * undownloadable at exactly the point in the workflow where an adviser is most
 * likely to be setting up the next meeting. The worked examples stayed
 * viewable, which is why it read as "previews work, downloads don't".
 *
 * The rule: reading a document out of the app changes nothing about the
 * assessment, so it is never gated. Writing one back in changes everything, so
 * it always is.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

import { baseAssessment } from '@/lib/ciAssessment/__tests__/fixtures';

const toast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({ toast: (...args: unknown[]) => toast(...args) }));

// The real module inlines four Office documents as base64; jsdom does not need
// them to answer the question this file asks.
const packSourceDocument = vi.fn((kind: string, variant: string) => ({
  id: `${kind}-${variant}`,
  kind,
  variant,
  fileName: kind === 'workbook'
    ? 'CommercialIndustrialFinanceIntakeWorkbook.xlsx'
    : 'CommercialIndustrialFinanceIntakePack.docx',
  url: 'data:application/octet-stream;base64,AAA=',
  mimeType: 'application/octet-stream',
  title: 'Template',
}));
vi.mock('@/lib/ciAssessment/intakePack/sourceDocuments', () => ({
  packSourceDocument: (...args: [string, string]) => packSourceDocument(...args),
  PACK_SOURCE_DOCUMENTS: [],
  readSourceDocument: vi.fn(),
}));

const { IntakePackPanel } = await import('../IntakePackPanel');

beforeEach(() => { toast.mockReset(); packSourceDocument.mockClear(); });
afterEach(cleanup);

function renderPanel(props: { disabled?: boolean; linkedClientId?: string | null; onOpenClient?: () => void } = {}) {
  return render(
    <IntakePackPanel
      payload={baseAssessment()}
      assessmentReference="CI-202608-TS6PK"
      assessmentTitle="Test"
      onApply={() => {}}
      onCreateClient={() => {}}
      {...props}
    />,
  );
}

describe('blank template downloads', () => {
  it('offers both templates on a read-only assessment', () => {
    renderPanel({ disabled: true });
    const buttons = screen.getAllByRole('button', { name: /download blank template/i });
    expect(buttons).toHaveLength(2);
    buttons.forEach((button) => expect(button).toBeEnabled());
  });

  it('offers them on an editable assessment too — nothing about them is conditional', () => {
    renderPanel({ disabled: false });
    screen.getAllByRole('button', { name: /download blank template/i })
      .forEach((button) => expect(button).toBeEnabled());
  });

  it('keeps the worked examples viewable while read-only', () => {
    renderPanel({ disabled: true });
    screen.getAllByRole('button', { name: /view completed example/i })
      .forEach((button) => expect(button).toBeEnabled());
  });

  it('still closes the import on a read-only assessment', () => {
    // The other half of the rule: the drop zone is what actually changes the
    // assessment, and it stays shut.
    renderPanel({ disabled: true });
    const dropzone = screen.getByLabelText(/drop the completed workbook/i);
    expect(dropzone.className).toContain('cursor-not-allowed');
  });

  it('hands over the approved file, by its approved name', async () => {
    renderPanel({ disabled: true });
    const click = vi.fn();
    const anchor = document.createElement('a');
    anchor.click = click;
    const realCreate = document.createElement.bind(document);
    const create = vi.spyOn(document, 'createElement').mockImplementation(
      (tag: string, ...rest: unknown[]) => (tag === 'a' ? anchor : realCreate(tag, ...rest as [])),
    );

    screen.getAllByRole('button', { name: /download blank template/i })[0].click();
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(anchor.download).toBe('CommercialIndustrialFinanceIntakeWorkbook.xlsx');
    // Straight at the inlined source: nothing re-zips or re-saves the bytes.
    expect(anchor.getAttribute('href')).toContain('data:');
    create.mockRestore();
  });
});

describe('the client hand-off', () => {
  it('offers to create a client while the assessment is unlinked', () => {
    renderPanel();
    expect(screen.getByRole('button', { name: /create a new client/i })).toBeInTheDocument();
  });

  it('offers the linked client instead, once there is one', () => {
    const onOpenClient = vi.fn();
    renderPanel({ linkedClientId: 'c1a2b3c4-d5e6-4f70-8123-456789abcdef', onOpenClient });
    expect(screen.queryByRole('button', { name: /create a new client/i })).not.toBeInTheDocument();
    screen.getByRole('button', { name: /open client/i }).click();
    expect(onOpenClient).toHaveBeenCalled();
  });
});
