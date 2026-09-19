/**
 * The two surfaces that carry the "which of these three do I want?" answer.
 *
 * Rendered rather than only unit-tested because the complaint was about what
 * the screen *says* — and because both of these had accessibility defects that
 * only a render shows: the choice cards were a button nested inside a button,
 * and the split control's menu had to keep working from the keyboard.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { TemplateStartChoices } from '../TemplateStartChoices';
import { TemplateStartSplitButton } from '../TemplateStartSplitButton';
import { TEMPLATE_START_ROUTES } from '@/lib/reportTemplate/templateStartRoutes';

const handlers = () => ({ onBlank: vi.fn(), onImport: vi.fn(), onConvert: vi.fn() });

describe('TemplateStartChoices', () => {
  it('shows all three routes with what each one gives you', () => {
    render(<TemplateStartChoices {...handlers()} />);
    for (const route of TEMPLATE_START_ROUTES) {
      expect(screen.getByText(route.title)).toBeTruthy();
      // `getAllByText` — two of the three end in an editable template, which is
      // the point: Import and Convert differ in *how*, not in what you hold.
      expect(screen.getAllByText(route.outcome).length).toBeGreaterThan(0);
    }
  });

  it('offers exactly one control per card', () => {
    // The card used to be `role="button"` with a `<Button>` inside it — two
    // overlapping controls for one action, which is invalid and reads as a
    // duplicate to a screen reader.
    render(<TemplateStartChoices {...handlers()} />);
    expect(screen.getAllByRole('button')).toHaveLength(TEMPLATE_START_ROUTES.length);
  });

  it('runs the right handler when its button is used', () => {
    const h = handlers();
    render(<TemplateStartChoices {...h} />);
    const convert = TEMPLATE_START_ROUTES.find((r) => r.key === 'convert')!;
    fireEvent.click(screen.getByRole('button', { name: new RegExp(convert.cta, 'i') }));
    expect(h.onConvert).toHaveBeenCalledOnce();
    expect(h.onBlank).not.toHaveBeenCalled();
  });

  it('makes every card inert when the caller has no edit permission', () => {
    const h = handlers();
    render(<TemplateStartChoices {...h} disabled />);
    for (const button of screen.getAllByRole('button')) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
  });
});

describe('TemplateStartSplitButton', () => {
  it('makes New template the primary action', () => {
    render(<TemplateStartSplitButton {...handlers()} />);
    expect(screen.getByRole('button', { name: /new template/i })).toBeTruthy();
  });

  it('names the chevron for anyone who cannot see it', () => {
    render(<TemplateStartSplitButton {...handlers()} />);
    expect(screen.getByRole('button', { name: /other ways to start/i })).toBeTruthy();
  });

  it('explains Import and Convert inside the menu rather than as bare labels', async () => {
    const h = handlers();
    render(<TemplateStartSplitButton {...h} />);
    // Radix opens on pointerdown, not click.
    fireEvent.pointerDown(
      screen.getByRole('button', { name: /other ways to start/i }),
      { button: 0, ctrlKey: false, pointerType: 'mouse' },
    );

    const menu = await screen.findByRole('menu');
    const items = within(menu).getAllByRole('menuitem');
    expect(items).toHaveLength(2);

    // Each carries its outcome, which is the sentence the header was missing.
    for (const route of TEMPLATE_START_ROUTES.filter((r) => r.key !== 'blank')) {
      expect(within(menu).getByText(route.title)).toBeTruthy();
      expect(within(menu).getByText(route.outcome)).toBeTruthy();
    }
  });

  it('reaches the converter from the menu', async () => {
    const h = handlers();
    render(<TemplateStartSplitButton {...h} />);
    fireEvent.pointerDown(
      screen.getByRole('button', { name: /other ways to start/i }),
      { button: 0, ctrlKey: false, pointerType: 'mouse' },
    );
    const menu = await screen.findByRole('menu');
    fireEvent.click(within(menu).getByText('Convert an existing template'));
    expect(h.onConvert).toHaveBeenCalledOnce();
  });
});
