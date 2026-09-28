/**
 * The land-only report's switch: off, the cash flow is the lot as bought; on,
 * with a build contract, it is the new build the lot becomes.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CashFlowPlannedBuildPanel, type PlannedBuildDraft } from '../CashFlowPlannedBuildPanel';

const OFF: PlannedBuildDraft = { enabled: false, buildPrice: '', durationMonths: '', weeklyRent: '' };

describe('CashFlowPlannedBuildPanel', () => {
  it('offers the switch and nothing else while the land is land', () => {
    render(<CashFlowPlannedBuildPanel draft={OFF} onChange={() => {}} figures={null} />);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByLabelText(/Build contract price/)).toBeNull();
  });

  it('switching on asks for the build', () => {
    const onChange = vi.fn();
    render(<CashFlowPlannedBuildPanel draft={OFF} onChange={onChange} figures={null} />);
    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledWith({ ...OFF, enabled: true });
  });

  it('says a build price is needed before the schedule can be staged', () => {
    render(<CashFlowPlannedBuildPanel draft={{ ...OFF, enabled: true }} onChange={() => {}} figures={null} />);
    expect(screen.getByLabelText(/Build contract price/)).toBeInTheDocument();
    expect(screen.getByText(/Enter the build contract price/)).toBeInTheDocument();
  });

  it('states the project the cash flow is running on once a price is entered', () => {
    render(
      <CashFlowPlannedBuildPanel
        draft={{ enabled: true, buildPrice: '387000', durationMonths: '8', weeklyRent: '550' }}
        onChange={() => {}}
        figures={{
          landPrice: 319_900, buildPrice: 387_000, totalProject: 706_900, valueToday: 706_900,
          durationMonths: 8, weeklyRent: 550, loanToValueRatio: 90, loanAmount: 636_210, deposit: 70_690,
        }}
      />,
    );
    expect(screen.getByText('$706,900')).toBeInTheDocument();
    expect(screen.getByText('$636,210')).toBeInTheDocument();
    expect(screen.getByText(/Loan at 90% LVR/)).toBeInTheDocument();
  });

  it('refuses a price that is not a number', () => {
    const onChange = vi.fn();
    render(<CashFlowPlannedBuildPanel draft={{ ...OFF, enabled: true }} onChange={onChange} figures={null} />);
    fireEvent.change(screen.getByLabelText(/Build contract price/), { target: { value: 'abc' } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/Build contract price/), { target: { value: '387,000' } });
    expect(onChange).toHaveBeenCalledWith({ ...OFF, enabled: true, buildPrice: '387000' });
  });
});
