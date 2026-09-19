import * as React from 'react';
import { Input, Label } from 'npc-property-dashboard-ui';

export const Default = () => (
  <div style={{ width: 320 }}>
    <Input placeholder="Search properties, clients or files…" />
  </div>
);

export const WithLabel = () => (
  <div style={{ width: 320, display: 'grid', gap: 6 }}>
    <Label htmlFor="purchase-price">Purchase price</Label>
    <Input id="purchase-price" defaultValue="1,845,000" inputMode="numeric" />
  </div>
);

export const Types = () => (
  <div style={{ width: 320, display: 'grid', gap: 12 }}>
    <Input type="email" defaultValue="priya.nandakumar@npcservices.com.au" />
    <Input type="date" defaultValue="2026-09-12" />
    <Input type="password" defaultValue="correcthorsebattery" />
  </div>
);

// Each state is captioned — the disabled and invalid treatments are subtle
// enough that an uncaptioned stack reads as three identical fields.
export const States = () => (
  <div style={{ width: 340, display: 'grid', gap: 14 }}>
    <div style={{ display: 'grid', gap: 4 }}>
      <span className="text-muted-foreground" style={{ fontSize: 12 }}>
        Default
      </span>
      <Input defaultValue="Eleanor Harding" />
    </div>
    <div style={{ display: 'grid', gap: 4 }}>
      <span className="text-muted-foreground" style={{ fontSize: 12 }}>
        Disabled
      </span>
      <Input defaultValue="Locked after settlement" disabled />
    </div>
    <div style={{ display: 'grid', gap: 4 }}>
      <span className="text-muted-foreground" style={{ fontSize: 12 }}>
        Invalid
      </span>
      <Input
        defaultValue="53 004 085 61"
        aria-invalid
        className="border-destructive ring-2 ring-destructive/25"
      />
      <span className="text-destructive" style={{ fontSize: 12 }}>
        ABN must be 11 digits
      </span>
    </div>
  </div>
);
