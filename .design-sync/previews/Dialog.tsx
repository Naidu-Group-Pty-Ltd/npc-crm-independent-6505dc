import * as React from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from 'npc-property-dashboard-ui';

// Rendered open — a closed dialog previews as nothing but its trigger, which
// says nothing about the component.
export const Open = () => (
  <Dialog open>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Record settlement date</DialogTitle>
        <DialogDescription>
          This updates the matter timeline and notifies the assigned solicitor.
        </DialogDescription>
      </DialogHeader>
      <div style={{ display: 'grid', gap: 6 }}>
        <Label htmlFor="settlement-date">Settlement date</Label>
        <Input id="settlement-date" type="date" defaultValue="2026-09-12" />
      </div>
      <DialogFooter>
        <Button variant="outline">Cancel</Button>
        <Button>Save</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);

export const Confirmation = () => (
  <Dialog open>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Withdraw application?</DialogTitle>
        <DialogDescription>
          NPC-2827 will be marked withdrawn and removed from the active pipeline. This cannot be
          undone.
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="outline">Keep application</Button>
        <Button variant="destructive">Withdraw</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
