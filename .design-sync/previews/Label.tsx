import * as React from 'react';
import { Checkbox, Input, Label } from 'npc-property-dashboard-ui';

export const Default = () => <Label>Borrower full name</Label>;

export const WithControl = () => (
  <div style={{ width: 320, display: 'grid', gap: 6 }}>
    <Label htmlFor="abn">ABN</Label>
    <Input id="abn" defaultValue="53 004 085 616" />
  </div>
);

export const Inline = () => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
    <Checkbox id="consent" defaultChecked />
    <Label htmlFor="consent">Client consents to a credit enquiry</Label>
  </div>
);
