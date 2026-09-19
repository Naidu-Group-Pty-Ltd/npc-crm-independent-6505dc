import * as React from "react";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/**
 * ResponsiveTable: opt-in wrapper that renders a standard <Table> on tablet/desktop
 * and stacks each row as a card on mobile (<768px). Preserves all dark/light theme
 * tokens and accepts arbitrary cell renderers.
 *
 * Usage:
 *   <ResponsiveTable
 *     columns={[
 *       { key: 'name', header: 'Name', cell: (r) => r.name },
 *       { key: 'status', header: 'Status', cell: (r) => <Badge>{r.status}</Badge> },
 *     ]}
 *     rows={data}
 *     getRowKey={(r) => r.id}
 *   />
 */

export type ResponsiveTableColumn<T> = {
  key: string;
  header: React.ReactNode;
  cell: (row: T, index: number) => React.ReactNode;
  /** Hide on mobile card view (rarely needed). */
  hideOnMobile?: boolean;
  /** Tailwind classes applied to the desktop <td>. */
  className?: string;
  /** Tailwind classes applied to the desktop <th>. */
  headClassName?: string;
};

export type ResponsiveTableProps<T> = {
  columns: ResponsiveTableColumn<T>[];
  rows: T[];
  getRowKey: (row: T, index: number) => string | number;
  onRowClick?: (row: T) => void;
  empty?: React.ReactNode;
  className?: string;
  /** Force mobile card layout regardless of viewport. */
  forceCards?: boolean;
};

export function ResponsiveTable<T>({
  columns,
  rows,
  getRowKey,
  onRowClick,
  empty,
  className,
  forceCards,
}: ResponsiveTableProps<T>) {
  const isMobile = useIsMobile();
  const useCards = forceCards || isMobile;

  if (rows.length === 0 && empty) {
    return <div className={cn("w-full", className)}>{empty}</div>;
  }

  if (useCards) {
    return (
      <div className={cn("flex flex-col gap-2", className)}>
        {rows.map((row, idx) => (
          <button
            key={getRowKey(row, idx)}
            type="button"
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            className={cn(
              "w-full rounded-lg border border-border/60 bg-card/60 dark:bg-card/40 p-3 text-left shadow-sm transition-colors",
              onRowClick && "hover:bg-muted/40 active:bg-muted/60 cursor-pointer",
              !onRowClick && "cursor-default"
            )}
          >
            <dl className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-x-3 gap-y-1.5">
              {columns
                .filter((c) => !c.hideOnMobile)
                .map((c) => (
                  <React.Fragment key={c.key}>
                    <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      {c.header}
                    </dt>
                    <dd className="min-w-0 text-sm text-foreground break-words">
                      {c.cell(row, idx)}
                    </dd>
                  </React.Fragment>
                ))}
            </dl>
          </button>
        ))}
      </div>
    );
  }

  return (
    <Table className={className}>
      <TableHeader>
        <TableRow>
          {columns.map((c) => (
            <TableHead key={c.key} className={c.headClassName}>
              {c.header}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, idx) => (
          <TableRow
            key={getRowKey(row, idx)}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            className={onRowClick ? "cursor-pointer" : undefined}
          >
            {columns.map((c) => (
              <TableCell key={c.key} className={c.className}>
                {c.cell(row, idx)}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
