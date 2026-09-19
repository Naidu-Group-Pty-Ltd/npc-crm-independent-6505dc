import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  StampDutyCalculatorPanel,
  type DutiableValueBasis,
  type StampDutyCalculatorPanelProps,
} from '../StampDutyCalculatorPanel';
import { calculateStampDuty, type PropertyCategory } from '@/utils/stampDutyCalculator';

/**
 * These cover the thing that made the panel unusable for a new build: the
 * dutiable value was rendered as read-only text taken from the purchase price,
 * so a house-and-land report could not be assessed on the land contract. The
 * iframe the panel replaced at least allowed the figure to be typed over.
 */

const PURCHASE_PRICE = 683_700;
const LAND_PRICE = 325_000;

const LAND_BASIS: DutiableValueBasis = {
  id: 'land',
  label: 'Land price',
  value: LAND_PRICE,
  hint: 'house & land — duty on the land contract',
  impliesCategory: 'vacant_land',
};

const PURCHASE_BASIS: DutiableValueBasis = {
  id: 'purchase',
  label: 'Full purchase price',
  value: PURCHASE_PRICE,
  impliesCategory: 'new',
};

/** Drives the controlled props the way both real call sites do. */
function Harness({
  initialValue = PURCHASE_PRICE,
  initialCategory = 'established',
  ...overrides
}: Partial<StampDutyCalculatorPanelProps> & {
  initialValue?: number;
  initialCategory?: PropertyCategory;
} = {}) {
  const [dutiableValue, setDutiableValue] = useState(initialValue);
  const [category, setCategory] = useState<PropertyCategory>(initialCategory);

  return (
    <StampDutyCalculatorPanel
      dutiableValue={dutiableValue}
      onDutiableValueChange={setDutiableValue}
      purchasePrice={PURCHASE_PRICE}
      bases={[LAND_BASIS, PURCHASE_BASIS]}
      state="NSW"
      onStateChange={vi.fn()}
      intent="investor"
      onIntentChange={vi.fn()}
      category={category}
      onCategoryChange={setCategory}
      isFirstHomeBuyer={false}
      onFirstHomeBuyerChange={vi.fn()}
      isForeignBuyer={false}
      onForeignBuyerChange={vi.fn()}
      {...overrides}
    />
  );
}

const dutiableInput = () => screen.getByLabelText(/dutiable value/i) as HTMLInputElement;
const setDutiableValue = (value: string) =>
  fireEvent.change(dutiableInput(), { target: { value } });
const payable = () =>
  screen.getByText(/stamp duty payable/i).parentElement?.textContent?.replace(/[^\d]/g, '') ?? '';

describe('StampDutyCalculatorPanel — dutiable value', () => {
  it('renders the dutiable value as an editable field, not read-only text', () => {
    render(<Harness />);
    const input = dutiableInput();
    expect(input).toBeInTheDocument();
    expect(input).not.toBeDisabled();
    expect(input).not.toHaveAttribute('readonly');
  });

  it('lets the land price be typed over the purchase price', () => {
    render(<Harness />);

    setDutiableValue('325000');

    expect(dutiableInput()).toHaveValue('325,000');
    const expected = calculateStampDuty({
      propertyValue: LAND_PRICE, state: 'NSW', intent: 'investor', category: 'established',
    }).totalDuty;
    expect(payable()).toContain(String(expected));
  });

  it('assesses duty on the dutiable value rather than the purchase price', () => {
    render(<Harness />);

    const onFullPrice = payable();
    setDutiableValue('325000');

    expect(payable()).not.toBe(onFullPrice);
  });

  it('accepts commas and rejects letters rather than silently zeroing', () => {
    render(<Harness />);

    setDutiableValue('450,000');
    expect(dutiableInput()).toHaveValue('450,000');

    setDutiableValue('450,000abc');
    // A value that quietly became 0 would report nil duty, which reads as a
    // legitimate answer — so the keystrokes are dropped instead.
    expect(dutiableInput()).toHaveValue('450,000');
  });

  it('shows an empty field rather than a zero when cleared', () => {
    render(<Harness />);
    setDutiableValue('');
    expect(dutiableInput()).toHaveValue('');
    expect(screen.getByText(/enter the value duty is assessed on/i)).toBeInTheDocument();
  });
});

describe('StampDutyCalculatorPanel — bases', () => {
  it('offers the land price as a one-click basis', () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole('button', { name: /land price/i }));

    expect(dutiableInput()).toHaveValue('325,000');
  });

  it('switches the category to vacant land when the land basis is chosen', () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole('button', { name: /land price/i }));

    // Assessing a land price under "new home" would test the wrong first-home
    // thresholds — NSW allows $800k on a home and $350k on land.
    expect(screen.getByLabelText(/^buying$/i)).toHaveTextContent(/vacant land/i);
  });

  it('marks the active basis as pressed', () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole('button', { name: /land price/i }));

    expect(screen.getByRole('button', { name: /land price/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /full purchase price/i })).toHaveAttribute('aria-pressed', 'false');
  });

  it('says which figure duty is being assessed on when it is not the purchase price', () => {
    render(<Harness />);

    expect(screen.queryByText(/not the .* purchase price/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /land price/i }));

    expect(screen.getByText(/not the/i)).toHaveTextContent(/\$683,700 purchase price/);
  });

  it('reports duty against both the dutiable value and the purchase price', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: /land price/i }));

    // Both matter: the effective rate on what is being taxed, and what the duty
    // costs as a share of the package the client is actually buying.
    expect(screen.getByText(/% of the dutiable value/i)).toHaveTextContent(/% of the \$683,700 purchase price/);
  });
});

describe('StampDutyCalculatorPanel — category mismatch', () => {
  it('warns when a land price is being assessed as a home', () => {
    render(<Harness initialValue={LAND_PRICE} initialCategory="established" />);

    expect(screen.getByText(/normally assessed as vacant land/i)).toBeInTheDocument();
  });

  it('offers a one-click correction that clears the warning', () => {
    render(<Harness initialValue={LAND_PRICE} initialCategory="established" />);

    fireEvent.click(screen.getByRole('button', { name: /switch to vacant land/i }));

    expect(screen.queryByText(/normally assessed as vacant land/i)).not.toBeInTheDocument();
  });

  it('does not warn when the basis and the category already agree', () => {
    render(<Harness initialValue={LAND_PRICE} initialCategory="vacant_land" />);

    expect(screen.queryByText(/normally assessed as/i)).not.toBeInTheDocument();
  });

  it('changes the assessed duty, which is why the mismatch is worth flagging', () => {
    // A first home buyer on $400k: assessed as a home NSW exempts it entirely;
    // assessed as vacant land the $350k/$450k thresholds only partly relieve it.
    const asHome = calculateStampDuty({
      propertyValue: 400_000, state: 'NSW', intent: 'owner_occupier',
      category: 'established', isFirstHomeBuyer: true,
    });
    const asLand = calculateStampDuty({
      propertyValue: 400_000, state: 'NSW', intent: 'owner_occupier',
      category: 'vacant_land', isFirstHomeBuyer: true,
    });

    expect(asHome.totalDuty).toBe(0);
    expect(asLand.totalDuty).toBeGreaterThan(0);
  });
});

describe('StampDutyCalculatorPanel — applying the figure', () => {
  it('hands back the duty on the edited value, not on the purchase price', () => {
    const onUseValue = vi.fn();
    render(<Harness onUseValue={onUseValue} />);

    fireEvent.click(screen.getByRole('button', { name: /land price/i }));
    fireEvent.click(screen.getByRole('button', { name: /use this figure/i }));

    const expected = calculateStampDuty({
      propertyValue: LAND_PRICE, state: 'NSW', intent: 'investor', category: 'vacant_land',
    }).totalDuty;
    expect(onUseValue).toHaveBeenCalledWith(expected);
  });

  it('disables editing when the panel is disabled', () => {
    render(<Harness disabled />);
    expect(dutiableInput()).toBeDisabled();
    expect(screen.getByRole('button', { name: /land price/i })).toBeDisabled();
  });

  it('still cites the schedule year and revenue office', () => {
    render(<Harness />);
    const footer = screen.getByText(/financial year/i);
    expect(footer).toHaveTextContent(/2026-27/);
    expect(screen.getByRole('link', { name: /revenue office rates/i })).toHaveAttribute(
      'href',
      expect.stringContaining('revenue.nsw.gov.au'),
    );
  });
});

describe('StampDutyCalculatorPanel — without bases', () => {
  it('still allows a free-typed dutiable value', () => {
    render(<Harness bases={[]} />);

    expect(screen.queryByRole('button', { name: /land price/i })).not.toBeInTheDocument();

    setDutiableValue('900000');
    expect(dutiableInput()).toHaveValue('900,000');
  });
});
