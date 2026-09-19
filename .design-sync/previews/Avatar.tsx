import * as React from 'react';
import { Avatar, AvatarFallback, AvatarImage } from 'npc-property-dashboard-ui';

// AvatarImage needs a real load to show anything, and previews render offline —
// so the fallback is the honest render here. An inline data-URI covers the
// image case without a network fetch.
const SWATCH =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80">' +
      '<rect width="80" height="80" fill="#512da8"/>' +
      '<circle cx="40" cy="32" r="14" fill="#ffffff" opacity="0.9"/>' +
      '<ellipse cx="40" cy="68" rx="24" ry="16" fill="#ffffff" opacity="0.9"/>' +
      '</svg>',
  );

export const Fallback = () => (
  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
    <Avatar>
      <AvatarFallback>PN</AvatarFallback>
    </Avatar>
    <Avatar>
      <AvatarFallback>TW</AvatarFallback>
    </Avatar>
    <Avatar>
      <AvatarFallback>HF</AvatarFallback>
    </Avatar>
  </div>
);

export const WithImage = () => (
  <Avatar>
    <AvatarImage src={SWATCH} alt="Priya Nandakumar" />
    <AvatarFallback>PN</AvatarFallback>
  </Avatar>
);

export const Sizes = () => (
  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
    <Avatar className="h-6 w-6">
      <AvatarFallback style={{ fontSize: 10 }}>SM</AvatarFallback>
    </Avatar>
    <Avatar>
      <AvatarFallback>MD</AvatarFallback>
    </Avatar>
    <Avatar className="h-14 w-14">
      <AvatarFallback style={{ fontSize: 18 }}>LG</AvatarFallback>
    </Avatar>
  </div>
);

export const Stack = () => (
  <div style={{ display: 'flex' }}>
    {['PN', 'TW', 'HF', '+3'].map((initials, i) => (
      <Avatar key={initials} className="border-2 border-background" style={{ marginLeft: i ? -10 : 0 }}>
        <AvatarFallback>{initials}</AvatarFallback>
      </Avatar>
    ))}
  </div>
);
