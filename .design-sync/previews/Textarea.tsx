import * as React from 'react';
import { Label, Textarea } from 'npc-property-dashboard-ui';

export const Default = () => (
  <div style={{ width: 380 }}>
    <Textarea placeholder="Add a file note…" />
  </div>
);

export const WithLabel = () => (
  <div style={{ width: 380, display: 'grid', gap: 6 }}>
    <Label htmlFor="file-note">File note</Label>
    <Textarea
      id="file-note"
      rows={4}
      defaultValue={
        'Vendor solicitor confirmed the s149 certificate has been ordered. Awaiting building and pest ' +
        'before the cooling-off period closes on 8 August.'
      }
    />
  </div>
);

export const Disabled = () => (
  <div style={{ width: 380 }}>
    <Textarea disabled defaultValue="Notes are read-only once the matter is archived." rows={3} />
  </div>
);
