import { memo, useMemo, useState } from 'react';
import { useFieldArray, useFormContext, useWatch, type UseFormRegister } from 'react-hook-form';
import { Landmark, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { ASSET_COLUMNS } from '@/lib/client-fact-find/fieldDefinitions';
import { calculateAssetTotalsCents, centsToDisplay } from '@/lib/client-fact-find/calculations';
import type { AdvancedClientCreationPayload, FactFindAsset } from '@/lib/client-fact-find/types';
import { AdvancedSectionHeader, premiumSectionClass } from './AdvancedSectionHeader';
import { advField, advKpi, advLabel, advSubCard } from './advancedTheme';
import { createEmptyAsset } from './defaults';

const names = ['assetType', 'descriptionOrAddress', 'owner', 'currentValue', 'rentalOrOtherIncome', 'financialInstitution', 'loanBalance', 'monthlyRepayment', 'interestRate', 'maturityDate'] as const;
const numericNames = new Set<string>(['currentValue', 'rentalOrOtherIncome', 'loanBalance', 'monthlyRepayment', 'interestRate']);
const wideNames = new Set<string>(['descriptionOrAddress', 'financialInstitution']);
const isBlankAsset = (asset: FactFindAsset) => names.every(name => asset[name] === '' || asset[name] === null || asset[name] === 0);

export function AssetsTable() {
  const { control, getValues, register, setValue } = useFormContext<AdvancedClientCreationPayload>();
  const { fields, append, remove, replace } = useFieldArray({ control, name: 'assets' });
  const [pendingRemoval, setPendingRemoval] = useState<number | null>(null);
  const addAsset = () => append(createEmptyAsset(fields.length), { shouldFocus: true, focusName: `assets.${fields.length}.assetType` });
  const removeAsset = (index: number) => {
    if (fields.length === 1) replace([createEmptyAsset(0)]);
    else {
      remove(index);
      for (let next = index; next < fields.length - 1; next += 1) setValue(`assets.${next}.displayOrder`, next, { shouldDirty: true });
    }
    setPendingRemoval(null);
  };
  const requestRemoval = (index: number) => isBlankAsset(getValues(`assets.${index}`)) ? removeAsset(index) : setPendingRemoval(index);
  return <section data-testid="assets-table" className={`${premiumSectionClass} min-w-0 max-w-full`}>
    <AdvancedSectionHeader icon={Landmark} title="Assets" description="Add each property, account or investment held by the applicants." trailing={<div className="flex flex-wrap items-center justify-end gap-2"><AssetsTotals /><Button type="button" variant="outline" size="sm" className="border-success/30 text-success hover:bg-success/10 hover:text-success focus-visible:ring-success/40" onClick={addAsset}><Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />Add Asset</Button></div>} />
    <div className="grid min-w-0 gap-4 p-3 sm:p-5">
      {fields.map((field, row) => <AssetRow key={field.id} row={row} register={register} onRemove={() => requestRemoval(row)} />)}
      <Button type="button" variant="ghost" size="sm" className="justify-self-start text-success hover:bg-success/10 hover:text-success" onClick={addAsset}><Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />Add another asset</Button>
    </div>
    <AlertDialog open={pendingRemoval !== null} onOpenChange={open => !open && setPendingRemoval(null)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Remove Asset?</AlertDialogTitle><AlertDialogDescription>Remove this asset and all information entered for it?</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => pendingRemoval !== null && removeAsset(pendingRemoval)}>Remove</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </section>;
}

const AssetRow = memo(function AssetRow({ row, register, onRemove }: { row: number; register: UseFormRegister<AdvancedClientCreationPayload>; onRemove: () => void }) {
  return <fieldset data-testid="asset-card" className={`${advSubCard} group w-full min-w-0 max-w-full border-l-2 border-l-success/50 p-3 sm:p-4`}>
    <legend className="sr-only">Asset {row + 1}</legend>
    <div className="mb-3 flex items-center justify-between gap-2"><span aria-hidden="true" className="inline-flex items-center gap-2 rounded-full border border-success/25 bg-success/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-success">Asset {row + 1}</span><Button type="button" variant="ghost" size="sm" aria-label={`Remove Asset ${row + 1}`} className="h-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:ring-destructive/40" onClick={onRemove}><Trash2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />Remove Asset</Button></div>
    <input type="hidden" {...register(`assets.${row}.displayOrder`)} />
    <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">{names.map((name, column) => { const label = ASSET_COLUMNS[column].label; return <label key={name} className={`min-w-0 space-y-1.5 text-sm ${wideNames.has(name) ? 'sm:col-span-2' : ''}`}><span className={`block break-words ${advLabel}`}>{label}</span><input aria-label={`Asset ${row + 1} ${label}`} type={numericNames.has(name) ? 'number' : name === 'maturityDate' ? 'date' : 'text'} min={numericNames.has(name) ? 0 : undefined} step={name === 'interestRate' ? '0.0001' : numericNames.has(name) ? '0.01' : undefined} className={advField} {...register(`assets.${row}.${name}` as const, { setValueAs: value => numericNames.has(name) ? (value === '' ? 0 : Number(value)) : value })} /></label>; })}</div>
  </fieldset>;
});

function AssetsTotals() { const { control } = useFormContext<AdvancedClientCreationPayload>(); const assets = useWatch({ control, name: 'assets' }) ?? []; const totals = useMemo(() => calculateAssetTotalsCents(assets), [assets]); return <div data-testid="asset-totals" className="flex flex-wrap gap-2"><Kpi label="Total Assets" value={centsToDisplay(totals.totalAssetsCents)} /><Kpi label="Asset-Linked Debt" value={centsToDisplay(totals.totalAssetLinkedDebtCents)} /></div>; }
function Kpi({ label, value }: { label: string; value: string }) { return <div className={advKpi}><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">{label}</p><strong className="text-sm font-bold tabular-nums text-foreground">{value}</strong></div>; }
