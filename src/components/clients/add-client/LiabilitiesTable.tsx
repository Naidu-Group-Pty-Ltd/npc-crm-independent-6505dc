import { memo, useMemo, useState } from 'react';
import { useFieldArray, useFormContext, useWatch, type UseFormRegister } from 'react-hook-form';
import { CreditCard, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { LIABILITY_COLUMNS } from '@/lib/client-fact-find/fieldDefinitions';
import { calculateOtherLiabilitiesCents, centsToDisplay } from '@/lib/client-fact-find/calculations';
import type { AdvancedClientCreationPayload, FactFindLiability } from '@/lib/client-fact-find/types';
import { AdvancedSectionHeader, premiumSectionClass } from './AdvancedSectionHeader';
import { advField, advKpi, advLabel, advSubCard } from './advancedTheme';
import { createEmptyLiability } from './defaults';

const names = ['liabilityType', 'lender', 'accountOrDescription', 'owner', 'limitOrOriginalAmount', 'currentBalance', 'monthlyRepayment', 'interestRate', 'remainingTerm', 'notes'] as const;
const numericNames = new Set<string>(['limitOrOriginalAmount', 'currentBalance', 'monthlyRepayment', 'interestRate']);
const wideNames = new Set<string>(['lender', 'accountOrDescription']);
const isBlankLiability = (liability: FactFindLiability) => names.every(name => liability[name] === '' || liability[name] === null || liability[name] === 0);

export function LiabilitiesTable() {
  const { control, getValues, register, setValue } = useFormContext<AdvancedClientCreationPayload>();
  const { fields, append, remove, replace } = useFieldArray({ control, name: 'liabilities' });
  const [pendingRemoval, setPendingRemoval] = useState<number | null>(null);
  const addLiability = () => append(createEmptyLiability(fields.length), { shouldFocus: true, focusName: `liabilities.${fields.length}.liabilityType` });
  const removeLiability = (index: number) => {
    if (fields.length === 1) replace([createEmptyLiability(0)]);
    else {
      remove(index);
      for (let next = index; next < fields.length - 1; next += 1) setValue(`liabilities.${next}.displayOrder`, next, { shouldDirty: true });
    }
    setPendingRemoval(null);
  };
  const requestRemoval = (index: number) => isBlankLiability(getValues(`liabilities.${index}`)) ? removeLiability(index) : setPendingRemoval(index);
  return <section data-testid="liabilities-table" className={`${premiumSectionClass} min-w-0 max-w-full`}>
    <AdvancedSectionHeader icon={CreditCard} title="Liabilities" description="Add each non-asset-linked debt or credit facility held by the applicants." trailing={<div className="flex flex-wrap items-center justify-end gap-2"><LiabilityTotals /><Button type="button" variant="outline" size="sm" className="border-warning/30 text-warning hover:bg-warning/10 hover:text-warning focus-visible:ring-warning/40" onClick={addLiability}><Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />Add Liability</Button></div>} />
    <div className="grid min-w-0 gap-4 p-3 sm:p-5">
      {fields.map((field, row) => <LiabilityRow key={field.id} row={row} register={register} onRemove={() => requestRemoval(row)} />)}
      <Button type="button" variant="ghost" size="sm" className="justify-self-start text-warning hover:bg-warning/10 hover:text-warning" onClick={addLiability}><Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />Add another liability</Button>
    </div>
    <AlertDialog open={pendingRemoval !== null} onOpenChange={open => !open && setPendingRemoval(null)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Remove Liability?</AlertDialogTitle><AlertDialogDescription>Remove this liability and all information entered for it?</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => pendingRemoval !== null && removeLiability(pendingRemoval)}>Remove</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </section>;
}

const LiabilityRow = memo(function LiabilityRow({ row, register, onRemove }: { row: number; register: UseFormRegister<AdvancedClientCreationPayload>; onRemove: () => void }) {
  return <fieldset data-testid="liability-card" className={`${advSubCard} group w-full min-w-0 max-w-full border-l-2 border-l-warning/50 p-3 sm:p-4`}>
    <legend className="sr-only">Liability {row + 1}</legend>
    <div className="mb-3 flex items-center justify-between gap-2"><span aria-hidden="true" className="inline-flex items-center gap-2 rounded-full border border-warning/25 bg-warning/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-warning">Liability {row + 1}</span><Button type="button" variant="ghost" size="sm" aria-label={`Remove Liability ${row + 1}`} className="h-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:ring-destructive/40" onClick={onRemove}><Trash2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />Remove Liability</Button></div>
    <input type="hidden" {...register(`liabilities.${row}.displayOrder`)} />
    <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">{names.map((name, column) => { const label = LIABILITY_COLUMNS[column].label; return <label key={name} className={`min-w-0 space-y-1.5 text-sm ${wideNames.has(name) ? 'sm:col-span-2' : ''}`}><span className={`block break-words ${advLabel}`}>{label}</span><input aria-label={`Liability ${row + 1} ${label}`} type={numericNames.has(name) ? 'number' : 'text'} min={numericNames.has(name) ? 0 : undefined} step={name === 'interestRate' ? '0.0001' : numericNames.has(name) ? '0.01' : undefined} className={advField} {...register(`liabilities.${row}.${name}` as const, { setValueAs: value => numericNames.has(name) ? (value === '' ? 0 : Number(value)) : value })} /></label>; })}</div>
  </fieldset>;
});

function LiabilityTotals() { const { control } = useFormContext<AdvancedClientCreationPayload>(); const liabilities = useWatch({ control, name: 'liabilities' }) ?? []; const total = useMemo(() => calculateOtherLiabilitiesCents(liabilities), [liabilities]); return <div data-testid="liability-totals" className={advKpi}><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Other Liabilities</p><strong className="text-sm font-bold tabular-nums text-foreground">{centsToDisplay(total)}</strong></div>; }
