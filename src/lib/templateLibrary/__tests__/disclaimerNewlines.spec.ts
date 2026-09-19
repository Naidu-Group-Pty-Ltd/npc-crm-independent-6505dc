import { describe, it, expect } from 'vitest';
import { projectReportSettings } from '../../../../supabase/functions/_shared/organisationProjection.pure';

const REAL = 'As a Professional Property Consultant & Buyers Agent, we provide information and advice based on our \nexpertise and experience in the real estate market.\n\nWhile we strive to ensure the accuracy\nand relevance, real estate markets are dynamic.\n\nIt is important to understand risks.';

describe('the published disclaimer', () => {
  const org = projectReportSettings({ disclaimer: { text: REAL, is_enabled: true } });
  const value = org.disclaimer as string;

  it('carries no soft wrap', () => {
    expect(value).not.toMatch(/[^\n]\n[^\n]/);
  });
  it('keeps the paragraphs', () => {
    expect(value.split('\n\n')).toHaveLength(3);
  });
  it('never leaves a space before a newline, which is the shape WeasyPrint named', () => {
    expect(value).not.toMatch(/ \n/);
    expect(value).not.toMatch(/\n /);
  });
  it('joins the soft-wrapped sentence back together', () => {
    expect(value).toContain('based on our expertise and experience');
  });
});
