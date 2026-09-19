/**
 * The panel has one name, and it is the product's.
 *
 * "AI Decision Support" described the technique. **Aurixa Intelligence (AI)
 * Decision Support** is what this is called, and it has to read the same on
 * both surfaces because they are nested: the section header wraps the card, so
 * an adviser sees both at once and two spellings of one name read as two
 * different features.
 *
 * The card lives in a 6,600-line modal that cannot be rendered in a unit test,
 * so its half is asserted against the source — but against the source *using
 * the constant*, which is the property that actually stops the two drifting.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AI_PANEL_TITLE, CashFlowAiPanel } from '../CashFlowAiPanel';

const MODAL = readFileSync(
  resolve(__dirname, '../../../reports/CashFlowAnalysisModal.tsx'),
  'utf8',
);

describe('Aurixa Intelligence (AI) Decision Support', () => {
  it('is what the panel is called', () => {
    expect(AI_PANEL_TITLE).toBe('Aurixa Intelligence (AI) Decision Support');
  });

  it('is drawn on the section header', () => {
    render(<CashFlowAiPanel><div /></CashFlowAiPanel>);
    expect(screen.getByText(AI_PANEL_TITLE)).toBeTruthy();
  });

  it('draws nothing when there is nothing to compare', () => {
    // The panel is a frame around a comparison; with one property it is
    // furniture, and the name must not appear on a page that cannot use it.
    const { container } = render(<CashFlowAiPanel active={false}><div /></CashFlowAiPanel>);
    expect(container.textContent).toBe('');
  });

  it('is the same name on the card inside it, by construction', () => {
    expect(MODAL).toContain('AI_PANEL_TITLE');
    expect(MODAL).toContain("from '@/components/cash-flow/modal/CashFlowAiPanel'");
  });

  it('leaves no copy of the old name anywhere on the page', () => {
    for (const source of [MODAL, readFileSync(resolve(__dirname, '../CashFlowAiPanel.tsx'), 'utf8')]) {
      // The old strings, as they were rendered.
      expect(source).not.toContain('>AI Decision Support<');
      expect(source).not.toContain('AI Cash Flow Decision Support');
    }
  });
});
