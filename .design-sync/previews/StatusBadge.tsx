import * as React from 'react';
import { StatusBadge } from 'npc-property-dashboard-ui';

export const Tones = () => (
  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
    <StatusBadge tone="neutral">Draft</StatusBadge>
    <StatusBadge tone="success">Passed</StatusBadge>
    <StatusBadge tone="warning">Pending</StatusBadge>
    <StatusBadge tone="danger">Failed</StatusBadge>
    <StatusBadge tone="info">In review</StatusBadge>
    <StatusBadge tone="brand">Priority</StatusBadge>
  </div>
);

export const WithDot = () => (
  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
    <StatusBadge tone="success" dot>
      Verified
    </StatusBadge>
    <StatusBadge tone="warning" dot>
      Awaiting documents
    </StatusBadge>
    <StatusBadge tone="danger" dot>
      Escalated
    </StatusBadge>
  </div>
);

export const ComplianceRow = () => (
  <div style={{ display: 'grid', gap: 10, width: 360 }}>
    {[
      ['Identity verification', 'success', 'Passed'],
      ['Source of funds', 'warning', 'Pending'],
      ['PEP / sanctions screen', 'success', 'Passed'],
      ['Adverse media', 'danger', 'Escalated'],
    ].map(([label, tone, text]) => (
      <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>{label}</span>
        <StatusBadge tone={tone as 'success' | 'warning' | 'danger'} dot>
          {text}
        </StatusBadge>
      </div>
    ))}
  </div>
);
