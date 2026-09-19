import * as React from 'react';
import {
  Button,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from 'npc-property-dashboard-ui';

// Tooltip reads TooltipProvider context — composed here because that is the
// only render that is true to how it is used.
export const Open = () => (
  <TooltipProvider>
    <Tooltip open>
      <TooltipTrigger asChild>
        <Button variant="outline">LVR</Button>
      </TooltipTrigger>
      <TooltipContent>Loan amount divided by the lender-assessed property value.</TooltipContent>
    </Tooltip>
  </TooltipProvider>
);

export const OnIcon = () => (
  <TooltipProvider>
    <Tooltip open>
      <TooltipTrigger asChild>
        <Button size="icon" variant="ghost" aria-label="Help">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01" />
          </svg>
        </Button>
      </TooltipTrigger>
      <TooltipContent>Settlement is set by the contract, not the finance approval date.</TooltipContent>
    </Tooltip>
  </TooltipProvider>
);
