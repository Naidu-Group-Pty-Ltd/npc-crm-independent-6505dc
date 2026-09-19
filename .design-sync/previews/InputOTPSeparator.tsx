import * as React from 'react';
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from 'npc-property-dashboard-ui';

// InputOTPSeparator is a bare dash — it only reads as anything inside a full
// InputOTP composition, which is also the only render that is true to how it
// is used.
export const InSixDigitCode = () => (
  <InputOTP maxLength={6} value="428913" onChange={() => {}}>
    <InputOTPGroup>
      <InputOTPSlot index={0} />
      <InputOTPSlot index={1} />
      <InputOTPSlot index={2} />
    </InputOTPGroup>
    <InputOTPSeparator />
    <InputOTPGroup>
      <InputOTPSlot index={3} />
      <InputOTPSlot index={4} />
      <InputOTPSlot index={5} />
    </InputOTPGroup>
  </InputOTP>
);

export const Standalone = () => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
    <span className="text-muted-foreground" style={{ fontSize: 13 }}>
      separator →
    </span>
    <InputOTPSeparator />
  </div>
);
