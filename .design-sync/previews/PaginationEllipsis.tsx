import * as React from 'react';
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
} from 'npc-property-dashboard-ui';

// Only meaningful inside a pager — on its own it is three dots.
export const InPager = () => (
  <Pagination>
    <PaginationContent>
      <PaginationItem>
        <PaginationLink href="#">1</PaginationLink>
      </PaginationItem>
      <PaginationItem>
        <PaginationEllipsis />
      </PaginationItem>
      <PaginationItem>
        <PaginationLink href="#" isActive>
          12
        </PaginationLink>
      </PaginationItem>
      <PaginationItem>
        <PaginationEllipsis />
      </PaginationItem>
      <PaginationItem>
        <PaginationLink href="#">27</PaginationLink>
      </PaginationItem>
    </PaginationContent>
  </Pagination>
);

export const Standalone = () => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
    <span className="text-muted-foreground" style={{ fontSize: 13 }}>
      skipped pages →
    </span>
    <PaginationEllipsis />
  </div>
);
