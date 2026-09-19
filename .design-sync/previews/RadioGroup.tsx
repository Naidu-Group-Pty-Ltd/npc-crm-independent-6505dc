import * as React from 'react';
import { Label, RadioGroup, RadioGroupItem } from 'npc-property-dashboard-ui';

export const Default = () => (
  <RadioGroup defaultValue="owner-occupied" style={{ display: 'grid', gap: 10 }}>
    {[
      ['owner-occupied', 'Owner occupied'],
      ['investment', 'Investment'],
      ['refinance', 'Refinance'],
    ].map(([value, label]) => (
      <div key={value} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <RadioGroupItem value={value} id={value} />
        <Label htmlFor={value}>{label}</Label>
      </div>
    ))}
  </RadioGroup>
);

export const Horizontal = () => (
  <RadioGroup defaultValue="fixed" style={{ display: 'flex', gap: 20 }}>
    {[
      ['fixed', 'Fixed'],
      ['variable', 'Variable'],
      ['split', 'Split'],
    ].map(([value, label]) => (
      <div key={value} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <RadioGroupItem value={value} id={`rate-${value}`} />
        <Label htmlFor={`rate-${value}`}>{label}</Label>
      </div>
    ))}
  </RadioGroup>
);

export const Disabled = () => (
  <RadioGroup defaultValue="settled" disabled style={{ display: 'grid', gap: 10 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <RadioGroupItem value="settled" id="settled" />
      <Label htmlFor="settled">Settled — locked</Label>
    </div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <RadioGroupItem value="pending" id="pending" />
      <Label htmlFor="pending">Pending</Label>
    </div>
  </RadioGroup>
);
