import * as React from 'react';
import { Label, Slider } from 'npc-property-dashboard-ui';

// NOTE: src/components/ui/slider.tsx renders a single <SliderPrimitive.Thumb/>,
// so a two-value range only ever draws one handle. No range story here — it
// would show the component doing something it cannot actually do. Radix needs
// one Thumb per value to support ranges.
export const Default = () => (
  <div style={{ width: 320, padding: '16px 0' }}>
    <Slider defaultValue={[75]} max={100} step={1} />
  </div>
);

export const WithLabel = () => (
  <div style={{ width: 320, display: 'grid', gap: 10 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <Label>Loan to value ratio</Label>
      <span style={{ fontWeight: 600 }}>75%</span>
    </div>
    <Slider defaultValue={[75]} max={100} step={5} />
  </div>
);

export const Positions = () => (
  <div style={{ width: 320, display: 'grid', gap: 22, padding: '8px 0' }}>
    <Slider defaultValue={[10]} max={100} />
    <Slider defaultValue={[50]} max={100} />
    <Slider defaultValue={[95]} max={100} />
  </div>
);
