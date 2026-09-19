import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Eye, Pencil, Shield, Sparkles } from 'lucide-react';

export const FINANCE_PORTAL_TABLES = [
  { key: 'properties', label: 'Properties' },
  { key: 'income', label: 'Income' },
  { key: 'expenses', label: 'Expenses' },
  { key: 'assets', label: 'Assets' },
  { key: 'liabilities', label: 'Liabilities' },
  { key: 'employment', label: 'Employment' },
  { key: 'address_history', label: 'Address History' },
  { key: 'notes', label: 'Notes' },
  { key: 'contacts', label: 'Contacts' },
  { key: 'documents', label: 'Documents' },
  { key: 'borrowing_capacity', label: 'Borrowing Capacity' },
  { key: 'messages', label: 'Messages' },
] as const;

export type PermissionTableKey = typeof FINANCE_PORTAL_TABLES[number]['key'];

export interface FinancePermissionMatrix {
  [tableKey: string]: { view: boolean; edit: boolean; delete: boolean };
}

export const EMPTY_MATRIX: FinancePermissionMatrix = FINANCE_PORTAL_TABLES.reduce((acc, t) => {
  acc[t.key] = { view: false, edit: false, delete: false };
  return acc;
}, {} as FinancePermissionMatrix);

export function normalizeMatrix(input: any): FinancePermissionMatrix {
  const out: FinancePermissionMatrix = JSON.parse(JSON.stringify(EMPTY_MATRIX));
  if (!input || typeof input !== 'object') return out;
  for (const t of FINANCE_PORTAL_TABLES) {
    const p = input[t.key];
    if (p && typeof p === 'object') {
      out[t.key] = { view: !!p.view, edit: !!p.edit, delete: !!p.delete };
    }
  }
  return out;
}

const presets = [
  { id: 'full', label: 'Full', icon: Shield, build: (): FinancePermissionMatrix => {
    const m = JSON.parse(JSON.stringify(EMPTY_MATRIX));
    for (const t of FINANCE_PORTAL_TABLES) m[t.key] = { view: true, edit: true, delete: true };
    return m;
  }},
  { id: 'editor', label: 'Editor', icon: Pencil, build: (): FinancePermissionMatrix => {
    const m = JSON.parse(JSON.stringify(EMPTY_MATRIX));
    for (const t of FINANCE_PORTAL_TABLES) m[t.key] = { view: true, edit: true, delete: false };
    return m;
  }},
  { id: 'read', label: 'Read Only', icon: Eye, build: (): FinancePermissionMatrix => {
    const m = JSON.parse(JSON.stringify(EMPTY_MATRIX));
    for (const t of FINANCE_PORTAL_TABLES) m[t.key] = { view: true, edit: false, delete: false };
    return m;
  }},
  { id: 'none', label: 'None', icon: Sparkles, build: (): FinancePermissionMatrix => JSON.parse(JSON.stringify(EMPTY_MATRIX)) },
];

interface Props {
  matrix: FinancePermissionMatrix;
  onChange: (matrix: FinancePermissionMatrix) => void;
  showPresets?: boolean;
  disabled?: boolean;
}

export function FinancePermissionMatrixEditor({ matrix, onChange, showPresets = true, disabled = false }: Props) {
  const update = (table: string, field: 'view' | 'edit' | 'delete', value: boolean) => {
    const next: FinancePermissionMatrix = { ...matrix, [table]: { ...matrix[table], [field]: value } };
    // If view is unchecked, also unset edit/delete
    if (field === 'view' && !value) {
      next[table].edit = false;
      next[table].delete = false;
    }
    // If edit/delete is checked, force view on
    if ((field === 'edit' || field === 'delete') && value) {
      next[table].view = true;
    }
    onChange(next);
  };

  return (
    <div className="space-y-3">
      {showPresets && (
        <div className="flex flex-wrap gap-2">
          <span className="text-xs text-muted-foreground self-center mr-1">Presets:</span>
          {presets.map(p => (
            <Button
              key={p.id}
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1"
              disabled={disabled}
              onClick={() => onChange(p.build())}
            >
              <p.icon className="h-3 w-3" />
              {p.label}
            </Button>
          ))}
        </div>
      )}
      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Sub-table</TableHead>
              <TableHead className="w-20 text-center">View</TableHead>
              <TableHead className="w-20 text-center">Edit</TableHead>
              <TableHead className="w-20 text-center">Delete</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {FINANCE_PORTAL_TABLES.map(t => {
              const p = matrix[t.key] || { view: false, edit: false, delete: false };
              return (
                <TableRow key={t.key}>
                  <TableCell className="font-medium">{t.label}</TableCell>
                  <TableCell className="text-center">
                    <Checkbox
                      checked={p.view}
                      disabled={disabled}
                      onCheckedChange={v => update(t.key, 'view', !!v)}
                    />
                  </TableCell>
                  <TableCell className="text-center">
                    <Checkbox
                      checked={p.edit}
                      disabled={disabled || !p.view}
                      onCheckedChange={v => update(t.key, 'edit', !!v)}
                    />
                  </TableCell>
                  <TableCell className="text-center">
                    <Checkbox
                      checked={p.delete}
                      disabled={disabled || !p.view}
                      onCheckedChange={v => update(t.key, 'delete', !!v)}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
