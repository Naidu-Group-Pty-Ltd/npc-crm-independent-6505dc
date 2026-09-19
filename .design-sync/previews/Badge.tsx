import * as React from 'react';
import { Badge } from 'npc-property-dashboard-ui';

export const Variants = () => (
  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
    <Badge>Default</Badge>
    <Badge variant="secondary">Secondary</Badge>
    <Badge variant="brand">Brand</Badge>
    <Badge variant="outline">Outline</Badge>
  </div>
);

export const Semantic = () => (
  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
    <Badge variant="success">Settled</Badge>
    <Badge variant="warning">Pending</Badge>
    <Badge variant="info">In review</Badge>
    <Badge variant="destructive">Declined</Badge>
  </div>
);

export const InContext = () => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
    <span style={{ fontWeight: 600 }}>14 Marlborough Street, Balmain</span>
    <Badge variant="success">Unconditional</Badge>
  </div>
);
