import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Eye, Pencil, Shield, Sparkles } from 'lucide-react';

/**
 * Solicitor Portal permission keys.
 *
 * Mirrors `SOLICITOR_PERMISSION_KEYS` in `_shared/solicitorPortalAuth.ts`.
 * Financial / AML-restricted keys are intentionally absent — tri-portal
 * separation means legal practitioners never see the client's financial
 * position or any restricted regulatory record, and the server strips those
 * keys even if a client ever sent them.
 */
export const SOLICITOR_PERMISSION_AREAS = [
  { key: 'matters', label: 'Matters', hint: 'The conveyancing file itself' },
  { key: 'critical_dates', label: 'Critical Dates', hint: 'Cooling off, finance, settlement' },
  { key: 'documents', label: 'Documents', hint: 'Contract pack and attachments' },
  { key: 'searches', label: 'Searches', hint: 'Title, planning and council searches' },
  { key: 'disbursements', label: 'Disbursements', hint: 'Legal costs and outlays' },
  { key: 'parties', label: 'Parties', hint: 'Vendors, purchasers, agents' },
  { key: 'contract', label: 'Contract Review', hint: 'Special conditions and requisitions' },
  { key: 'messages', label: 'Messages', hint: 'Secure tri-portal threads' },
  { key: 'client_tasks', label: 'Client Tasks', hint: 'Action items issued to the client' },
  { key: 'settlement', label: 'Settlement', hint: 'Settlement runway and booking' },
  { key: 'finance_status', label: 'Finance Status', hint: 'Read-only approval milestones (never figures)' },
  { key: 'audit', label: 'Audit Trail', hint: 'Read-only matter history' },
] as const;

export type SolicitorPermissionKey = typeof SOLICITOR_PERMISSION_AREAS[number]['key'];

/** Areas that are read-only by design — no edit/delete may ever be granted. */
const VIEW_ONLY_KEYS = new Set<string>(['finance_status', 'audit']);

export interface SolicitorPermissionMatrix {
  [key: string]: { view: boolean; edit: boolean; delete: boolean };
}

export const EMPTY_SOLICITOR_MATRIX: SolicitorPermissionMatrix = SOLICITOR_PERMISSION_AREAS.reduce(
  (acc, area) => {
    acc[area.key] = { view: false, edit: false, delete: false };
    return acc;
  },
  {} as SolicitorPermissionMatrix,
);

export function normalizeSolicitorMatrix(input: unknown): SolicitorPermissionMatrix {
  const out: SolicitorPermissionMatrix = JSON.parse(JSON.stringify(EMPTY_SOLICITOR_MATRIX));
  if (!input || typeof input !== 'object') return out;
  const src = input as Record<string, any>;
  for (const area of SOLICITOR_PERMISSION_AREAS) {
    const p = src[area.key];
    if (p && typeof p === 'object') {
      out[area.key] = {
        view: !!p.view,
        edit: VIEW_ONLY_KEYS.has(area.key) ? false : !!p.edit,
        delete: VIEW_ONLY_KEYS.has(area.key) ? false : !!p.delete,
      };
    }
  }
  return out;
}

function build(fn: (key: string) => { view: boolean; edit: boolean; delete: boolean }): SolicitorPermissionMatrix {
  const m: SolicitorPermissionMatrix = {};
  for (const area of SOLICITOR_PERMISSION_AREAS) m[area.key] = fn(area.key);
  return m;
}

const presets = [
  {
    id: 'full', label: 'Full', icon: Shield,
    build: () => build(k => ({
      view: true,
      edit: !VIEW_ONLY_KEYS.has(k),
      delete: !VIEW_ONLY_KEYS.has(k),
    })),
  },
  {
    id: 'conveyancer', label: 'Conveyancer', icon: Pencil,
    build: () => build(k => ({ view: true, edit: !VIEW_ONLY_KEYS.has(k), delete: false })),
  },
  {
    id: 'read', label: 'Read Only', icon: Eye,
    build: () => build(() => ({ view: true, edit: false, delete: false })),
  },
  {
    id: 'none', label: 'None', icon: Sparkles,
    build: () => build(() => ({ view: false, edit: false, delete: false })),
  },
];

interface Props {
  matrix: SolicitorPermissionMatrix;
  onChange: (matrix: SolicitorPermissionMatrix) => void;
  showPresets?: boolean;
  disabled?: boolean;
}

export function SolicitorPermissionMatrixEditor({ matrix, onChange, showPresets = true, disabled = false }: Props) {
  const update = (key: string, field: 'view' | 'edit' | 'delete', value: boolean) => {
    const current = matrix[key] || { view: false, edit: false, delete: false };
    const next: SolicitorPermissionMatrix = { ...matrix, [key]: { ...current, [field]: value } };
    if (field === 'view' && !value) {
      next[key].edit = false;
      next[key].delete = false;
    }
    if ((field === 'edit' || field === 'delete') && value) {
      next[key].view = true;
    }
    if (VIEW_ONLY_KEYS.has(key)) {
      next[key].edit = false;
      next[key].delete = false;
    }
    onChange(next);
  };

  return (
    <div className="space-y-3">
      {showPresets && (
        <div className="flex flex-wrap gap-2">
          <span className="mr-1 self-center text-xs text-muted-foreground">Presets:</span>
          {presets.map(p => (
            <Button
              key={p.id}
              type="button"
              variant="outline"
              size="sm"
              className="h-7 gap-1 text-xs"
              disabled={disabled}
              onClick={() => onChange(p.build())}
            >
              <p.icon className="h-3 w-3" />
              {p.label}
            </Button>
          ))}
        </div>
      )}
      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Area</TableHead>
              <TableHead className="w-20 text-center">View</TableHead>
              <TableHead className="w-20 text-center">Edit</TableHead>
              <TableHead className="w-20 text-center">Delete</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {SOLICITOR_PERMISSION_AREAS.map(area => {
              const p = matrix[area.key] || { view: false, edit: false, delete: false };
              const readOnly = VIEW_ONLY_KEYS.has(area.key);
              return (
                <TableRow key={area.key}>
                  <TableCell>
                    <div className="font-medium">{area.label}</div>
                    <div className="text-xs text-muted-foreground">{area.hint}</div>
                  </TableCell>
                  <TableCell className="text-center">
                    <Checkbox
                      checked={p.view}
                      disabled={disabled}
                      onCheckedChange={v => update(area.key, 'view', !!v)}
                      aria-label={`View ${area.label}`}
                    />
                  </TableCell>
                  <TableCell className="text-center">
                    <Checkbox
                      checked={p.edit}
                      disabled={disabled || readOnly || !p.view}
                      onCheckedChange={v => update(area.key, 'edit', !!v)}
                      aria-label={`Edit ${area.label}`}
                    />
                  </TableCell>
                  <TableCell className="text-center">
                    <Checkbox
                      checked={p.delete}
                      disabled={disabled || readOnly || !p.view}
                      onCheckedChange={v => update(area.key, 'delete', !!v)}
                      aria-label={`Delete ${area.label}`}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">
        Financial position, borrowing capacity, commissions and restricted AML records are never
        available to the Solicitor Portal, regardless of this matrix.
      </p>
    </div>
  );
}
