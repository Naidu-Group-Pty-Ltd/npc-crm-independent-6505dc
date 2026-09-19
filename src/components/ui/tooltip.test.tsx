import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip';

const HINT = 'Annual rate for rent/expense increases. Default: 3%';

/**
 * The audit reported the same symptom twice — the Reports page's
 * "Pre-Generation Overrides" hint reading "…NUAL RATE FOR RENT/EXPENSE
 * INCREASES" (item 1) and the calendar tool rail's tooltips cut off at the
 * frame edge (item 32). Both were one cause: `TooltipContent` was laid out
 * inline beside its trigger, so a clipping ancestor sliced it in half. Radix
 * still positioned it correctly, which is why the symptom reads as "the text
 * runs outside the frame" rather than as a tooltip that never opened.
 *
 * This pins the behaviour rather than the markup: the content must escape a
 * container that clips.
 */
function ClippingHarness() {
  return (
    <TooltipProvider delayDuration={0}>
      <div data-testid="clipper" style={{ overflow: 'hidden', width: '40px' }}>
        <Tooltip>
          <TooltipTrigger>info</TooltipTrigger>
          <TooltipContent>
            <p>{HINT}</p>
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}

describe('TooltipContent', () => {
  it('renders the hint outside a clipping ancestor, in full', async () => {
    render(<ClippingHarness />);

    fireEvent.focus(screen.getByText('info'));

    // Radix renders the visible content plus a visually-hidden a11y copy.
    const matches = await screen.findAllByText(HINT);
    expect(matches.length).toBeGreaterThan(0);

    const clipper = screen.getByTestId('clipper');
    const escaped = matches.some((node) => !clipper.contains(node));

    expect(escaped).toBe(true);
  });
});
