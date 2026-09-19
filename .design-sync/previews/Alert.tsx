import * as React from 'react';
import { Alert, AlertDescription, AlertTitle } from 'npc-property-dashboard-ui';

const InfoIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="10" />
    <path d="M12 16v-4M12 8h.01" />
  </svg>
);

export const Default = () => (
  <Alert style={{ maxWidth: 460 }}>
    <InfoIcon />
    <AlertTitle>Cooling-off period ends 8 August</AlertTitle>
    <AlertDescription>
      Building and pest inspection results are still outstanding on this matter.
    </AlertDescription>
  </Alert>
);

export const Destructive = () => (
  <Alert variant="destructive" style={{ maxWidth: 460 }}>
    <InfoIcon />
    <AlertTitle>Verification failed</AlertTitle>
    <AlertDescription>
      The supplied document could not be matched against the DVS. Request an alternative form of
      identification before proceeding.
    </AlertDescription>
  </Alert>
);

export const TitleOnly = () => (
  <Alert style={{ maxWidth: 460 }}>
    <AlertTitle>Valuation received — $1,820,000</AlertTitle>
  </Alert>
);
