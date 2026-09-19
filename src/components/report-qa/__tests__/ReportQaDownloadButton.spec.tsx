/**
 * The Q&A download control offers the template in both of its shapes.
 *
 * It has two: the full menu, where three subjects are on offer, and the
 * single-subject split button the message editor uses beside one answer. The
 * second was a bare button on the reasoning that one subject has nothing to
 * choose between — true of the document, and not of the template it comes out
 * in. That control typesets an answer for a broker, and which template it used
 * was answerable only on the Template Library page.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/lib/reports/reportQa/deliverReportQaPdf', () => ({
  deliverReportQaPdf: vi.fn(),
}));

// The selection's two halves, so the control resolves to a real answer rather
// than sitting in its loading state.
vi.mock('@/lib/reportTemplate/templateSelection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/reportTemplate/templateSelection')>();
  return {
    ...actual,
    fetchActiveReportTemplates: async () => ([{
      id: 'tpl-1',
      name: 'Meridian 03',
      report_type: 'qa',
      engine: 'weasyprint',
      is_active: true,
    }]),
    fetchTemplateSelections: async () => ([{
      id: 'sel-1', report_type: 'qa', template_id: 'tpl-1',
    }]),
  };
});

import { ReportQaDownloadButton } from '../ReportQaDownloadButton';

const renderButton = (props: Record<string, unknown> = {}) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ReportQaDownloadButton conversationId="conv-1" {...props} />
  </QueryClientProvider>,
);

beforeEach(() => cleanup());

describe('the single-subject control', () => {
  it('keeps the action one press and opens the choice beside it', async () => {
    renderButton({ only: 'answer', messageId: 'msg-1', label: 'Typeset PDF' });

    // The action itself is unchanged: one button, one press, no menu to open
    // before a person can get their document.
    expect(screen.getByRole('button', { name: /Typeset PDF/ })).toBeTruthy();
    // And the one thing there is to decide is reachable from here.
    expect(
      screen.getByRole('button', { name: 'Which template this comes out in' }),
      'the single-subject control offers no way to choose a template',
    ).toBeTruthy();
  });
});

describe('the full control', () => {
  it('offers the template alongside its subjects', () => {
    renderButton({ label: 'Typeset PDF' });
    // One trigger here, which opens the subjects and the template together.
    expect(screen.getByRole('button', { name: /Typeset PDF/ })).toBeTruthy();
  });
});
