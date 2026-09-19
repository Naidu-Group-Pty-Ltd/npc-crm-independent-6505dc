import * as React from 'react';
import {
  StatusBadge,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from 'npc-property-dashboard-ui';

const ROWS = [
  ['NPC-2841', '14 Marlborough St, Balmain', '$1,845,000', '12 Sep 2026', 'success', 'Unconditional'],
  ['NPC-2839', '7/22 Rowe St, Eastwood', '$742,000', '29 Aug 2026', 'warning', 'Pending'],
  ['NPC-2833', '61 Bayview Tce, Clayfield', '$1,120,000', '05 Sep 2026', 'info', 'In review'],
  ['NPC-2827', '3 Kingsford Ave, Subiaco', '$980,500', '19 Aug 2026', 'danger', 'Escalated'],
];

export const MatterList = () => (
  <Table>
    <TableCaption>Active settlement matters — August 2026</TableCaption>
    <TableHeader>
      <TableRow>
        <TableHead>Matter</TableHead>
        <TableHead>Property</TableHead>
        <TableHead className="text-right">Price</TableHead>
        <TableHead>Settlement</TableHead>
        <TableHead>Status</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {ROWS.map(([id, property, price, date, tone, status]) => (
        <TableRow key={id}>
          <TableCell style={{ fontWeight: 600 }}>{id}</TableCell>
          <TableCell>{property}</TableCell>
          <TableCell className="text-right">{price}</TableCell>
          <TableCell>{date}</TableCell>
          <TableCell>
            <StatusBadge tone={tone as 'success' | 'warning' | 'info' | 'danger'}>{status}</StatusBadge>
          </TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>
);

export const WithFooter = () => (
  <Table>
    <TableHeader>
      <TableRow>
        <TableHead>Fee</TableHead>
        <TableHead className="text-right">Amount</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      <TableRow>
        <TableCell>Conveyancing</TableCell>
        <TableCell className="text-right">$1,320.00</TableCell>
      </TableRow>
      <TableRow>
        <TableCell>Searches and disbursements</TableCell>
        <TableCell className="text-right">$486.20</TableCell>
      </TableRow>
      <TableRow>
        <TableCell>Transfer duty</TableCell>
        <TableCell className="text-right">$83,940.00</TableCell>
      </TableRow>
    </TableBody>
    <TableFooter>
      <TableRow>
        <TableCell>Total</TableCell>
        <TableCell className="text-right">$85,746.20</TableCell>
      </TableRow>
    </TableFooter>
  </Table>
);
