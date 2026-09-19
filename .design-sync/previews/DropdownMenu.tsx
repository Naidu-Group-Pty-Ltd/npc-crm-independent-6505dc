import * as React from 'react';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from 'npc-property-dashboard-ui';

export const Open = () => (
  <DropdownMenu open>
    <DropdownMenuTrigger asChild>
      <Button variant="outline">Matter actions</Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent>
      <DropdownMenuLabel>NPC-2841</DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuItem>
        Open file
        <DropdownMenuShortcut>⌘O</DropdownMenuShortcut>
      </DropdownMenuItem>
      <DropdownMenuItem>Request documents</DropdownMenuItem>
      <DropdownMenuItem>Generate report</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem className="text-destructive">Withdraw application</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
);

export const Closed = () => (
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button variant="outline">Actions</Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent>
      <DropdownMenuItem>Open file</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
);
