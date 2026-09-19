import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { OtpInput } from '../OtpInput';

/**
 * The six-box code entry shared by the Solicitor, Finance and Client portals.
 *
 * These are behaviour tests rather than render tests because the defect they
 * cover was invisible on screen until the code was submitted: a digit could sit
 * in one box and be sent as another. The boxes are the only view a user has of
 * what they are about to submit, so what is displayed and what `onChange`
 * reports must be the same string.
 */

function Harness({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <div>
      <OtpInput value={value} onChange={setValue} />
      <output data-testid="value">{value}</output>
    </div>
  );
}

const boxes = () => screen.getAllByRole('textbox') as HTMLInputElement[];
const shown = () => boxes().map((box) => box.value).join('');
const reported = () => screen.getByTestId('value').textContent;

/** Type into whichever box currently has the caret, as a person would. */
const typeHere = (digit: string) => {
  const box = document.activeElement as HTMLInputElement;
  fireEvent.change(box, { target: { value: digit } });
};

const typeInto = (index: number, digits: string) => {
  boxes()[index].focus();
  for (const digit of digits) typeHere(digit);
};

describe('OtpInput', () => {
  it('collects a code typed straight through', () => {
    render(<Harness />);
    typeInto(0, '469323');

    expect(reported()).toBe('469323');
    expect(shown()).toBe('469323');
  });

  it('puts a digit typed into a later box in the first empty box, and follows it', () => {
    render(<Harness />);

    // The old implementation wrote this digit at index 2 of a space-padded
    // array and then stripped the spaces, so the value became "9" — displayed
    // in box 1 — while the caret moved to box 4. Every digit after that landed
    // somewhere other than where it appeared to.
    typeInto(2, '9');

    expect(reported()).toBe('9');
    expect(shown()).toBe('9');
    expect(document.activeElement).toBe(boxes()[1]);
  });

  it('never reports a code the boxes are not showing', () => {
    render(<Harness />);
    typeInto(4, '1');
    typeInto(0, '2');
    typeInto(3, '3');

    expect(shown()).toBe(reported());
  });

  it('overwrites a stale code in place', () => {
    render(<Harness initial="111111" />);
    typeInto(0, '469323');

    expect(reported()).toBe('469323');
    expect(shown()).toBe('469323');
  });

  it('deletes with backspace and stops at the first box', () => {
    render(<Harness initial="4693" />);

    boxes()[3].focus();
    for (let i = 0; i < 5; i += 1) {
      fireEvent.keyDown(document.activeElement as HTMLInputElement, { key: 'Backspace' });
    }

    expect(reported()).toBe('');
    expect(shown()).toBe('');
  });

  it('accepts a pasted code and ignores the surrounding text', () => {
    render(<Harness />);

    fireEvent.paste(boxes()[0], {
      clipboardData: { getData: () => 'Your code is 469 323' },
    });

    expect(reported()).toBe('469323');
  });

  // Asserted on the DOM rather than by firing an event: fireEvent dispatches
  // straight at the React handler, which a disabled input would never reach in
  // a browser, so a change event here would prove nothing either way.
  it('closes every box while a verification is in flight', () => {
    render(<OtpInput value="4693" onChange={vi.fn()} disabled />);

    expect(boxes()).toHaveLength(6);
    for (const box of boxes()) expect(box).toBeDisabled();
  });
});
