import * as React from 'react';
import { Checkbox, Label } from 'npc-property-dashboard-ui';

export const States = () => (
  <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
    <Checkbox aria-label="Unchecked" />
    <Checkbox defaultChecked aria-label="Checked" />
    <Checkbox disabled aria-label="Disabled" />
    <Checkbox disabled defaultChecked aria-label="Disabled checked" />
  </div>
);

export const Checklist = () => (
  <div style={{ display: 'grid', gap: 12 }}>
    {[
      ['id-verified', 'Identity verified (100 point check)', true],
      ['contract-received', 'Contract of sale received', true],
      ['valuation-ordered', 'Valuation ordered', false],
      ['funds-confirmed', 'Funds to complete confirmed', false],
    ].map(([id, label, checked]) => (
      <div key={id as string} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Checkbox id={id as string} defaultChecked={checked as boolean} />
        <Label htmlFor={id as string}>{label as string}</Label>
      </div>
    ))}
  </div>
);
