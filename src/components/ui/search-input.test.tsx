import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SearchInput } from './search-input';

function Harness({ initial = '', ...rest }: { initial?: string } & Record<string, unknown>) {
  const [value, setValue] = useState(initial);
  return <SearchInput value={value} onValueChange={setValue} placeholder="Search clients..." {...rest} />;
}

describe('SearchInput', () => {
  it('offers no clear control until there is something to clear', () => {
    render(<Harness />);
    expect(screen.queryByRole('button', { name: /clear/i })).toBeNull();
    fireEvent.change(screen.getByPlaceholderText('Search clients...'), { target: { value: 'ar' } });
    expect(screen.getByRole('button', { name: /clear/i })).toBeTruthy();
  });

  it('empties the field and hides the control again', () => {
    render(<Harness initial="arvin" />);
    fireEvent.click(screen.getByRole('button', { name: /clear/i }));
    expect((screen.getByPlaceholderText('Search clients...') as HTMLInputElement).value).toBe('');
    expect(screen.queryByRole('button', { name: /clear/i })).toBeNull();
  });

  it('names the field it clears, so three on one page stay distinguishable', () => {
    render(<Harness initial="x" />);
    // Derived from the placeholder, with the ellipsis dropped.
    expect(screen.getByRole('button', { name: 'Clear search clients' })).toBeTruthy();
  });

  it('prefers an explicit aria-label over the placeholder', () => {
    render(<Harness initial="x" aria-label="Search reminders" />);
    expect(screen.getByRole('button', { name: 'Clear search reminders' })).toBeTruthy();
  });

  it('clears on Escape and does not let the key reach a surrounding dialog', () => {
    const onKeyDown = vi.fn();
    render(<Harness initial="arvin" onKeyDown={onKeyDown} />);
    const input = screen.getByPlaceholderText('Search clients...');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect((input as HTMLInputElement).value).toBe('');
    // The call site's own handler must not also run: Escape did one thing.
    expect(onKeyDown).not.toHaveBeenCalled();
  });

  it('passes Escape through once the field is already empty, so a dialog can close', () => {
    const onKeyDown = vi.fn();
    render(<Harness onKeyDown={onKeyDown} />);
    fireEvent.keyDown(screen.getByPlaceholderText('Search clients...'), { key: 'Escape' });
    expect(onKeyDown).toHaveBeenCalled();
  });

  it('leaves Escape alone where a call site opts out', () => {
    render(<Harness initial="arvin" clearOnEscape={false} />);
    const input = screen.getByPlaceholderText('Search clients...');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect((input as HTMLInputElement).value).toBe('arvin');
  });

  it('returns focus to the input so typing can continue', () => {
    render(<Harness initial="arvin" />);
    fireEvent.click(screen.getByRole('button', { name: /clear/i }));
    expect(document.activeElement).toBe(screen.getByPlaceholderText('Search clients...'));
  });

  it('is a button, never a submit, so it cannot post the form it sits in', () => {
    render(<Harness initial="x" />);
    expect(screen.getByRole('button', { name: /clear/i }).getAttribute('type')).toBe('button');
  });

  it('keeps className on the input and containerClassName on the wrapper', () => {
    const { container } = render(<Harness initial="x" className="h-9" containerClassName="flex-1" />);
    expect(container.querySelector('div.flex-1')).toBeTruthy();
    expect(screen.getByPlaceholderText('Search clients...').className).toContain('h-9');
  });

  it('reserves right padding only while the control is shown', () => {
    const { rerender } = render(<SearchInput value="" onValueChange={() => {}} placeholder="Search..." />);
    expect(screen.getByPlaceholderText('Search...').className).not.toContain('pr-9');
    rerender(<SearchInput value="a" onValueChange={() => {}} placeholder="Search..." />);
    expect(screen.getByPlaceholderText('Search...').className).toContain('pr-9');
  });

  it('drops the icon padding where the call site draws its own icon', () => {
    render(<SearchInput value="" onValueChange={() => {}} placeholder="Search..." hideIcon />);
    expect(screen.getByPlaceholderText('Search...').className).not.toContain('pl-9');
  });
});
