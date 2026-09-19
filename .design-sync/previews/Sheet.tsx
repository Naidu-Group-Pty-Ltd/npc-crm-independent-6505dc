import * as React from 'react';
import {
  Button,
  Input,
  Label,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from 'npc-property-dashboard-ui';

export const Open = () => (
  <Sheet open>
    <SheetContent>
      <SheetHeader>
        <SheetTitle>Edit borrower</SheetTitle>
        <SheetDescription>Changes apply to every matter linked to this client.</SheetDescription>
      </SheetHeader>
      <div style={{ display: 'grid', gap: 12, padding: '16px 0' }}>
        <div style={{ display: 'grid', gap: 6 }}>
          <Label htmlFor="borrower-name">Full name</Label>
          <Input id="borrower-name" defaultValue="Eleanor Harding" />
        </div>
        <div style={{ display: 'grid', gap: 6 }}>
          <Label htmlFor="borrower-email">Email</Label>
          <Input id="borrower-email" type="email" defaultValue="e.harding@example.com.au" />
        </div>
      </div>
      <SheetFooter>
        <Button>Save changes</Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>
);
