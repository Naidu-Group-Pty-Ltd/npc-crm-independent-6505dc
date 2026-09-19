import { useFormContext, useWatch } from 'react-hook-form';
import { WalletCards } from 'lucide-react';
import type { AdvancedClientCreationPayload } from '@/lib/client-fact-find/types';
import { calculateFactFindTotals, centsToDisplay } from '@/lib/client-fact-find/calculations';
import { LIVING_EXPENSE_ITEMS } from '@/lib/client-fact-find/fieldDefinitions';
import { advEyebrow, advField, advPanelHeader, advSurface } from './advancedTheme';

export function LivingExpensesTab() {
  const { register, control, getValues } = useFormContext<AdvancedClientCreationPayload>();
  useWatch({ control, name: 'expenses' });
  const total = calculateFactFindTotals(getValues()).totalMonthlyLivingExpensesCents;

  return <div className="space-y-3" data-testid="advanced-expenses-tab">
    <header className={`${advSurface} flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between`}>
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-brand-300/30 bg-primary/10 text-brand-200"><WalletCards className="h-5 w-5" aria-hidden="true" /></span>
        <div><p className={advEyebrow}>Worksheet</p><h2 className="text-[15px] font-semibold tracking-tight">Monthly Living Expenses</h2><p className="text-sm text-muted-foreground">One monthly worksheet list with 50 editable expense items.</p></div>
      </div>
      <div aria-live="polite" className="rounded-xl border border-brand-300/35 bg-primary/10 px-4 py-2.5 sm:min-w-60 sm:text-right">
        <p className="text-xs font-medium text-muted-foreground">Total Monthly Living Expenses</p>
        <strong className="text-xl font-bold tabular-nums text-foreground">{centsToDisplay(total)}</strong>
      </div>
    </header>

    <section data-testid="expense-continuous-list" aria-label="Living expenses worksheet" className={`${advSurface} w-full min-w-0`}>
      <div data-testid="expense-list-header" className={`sticky top-0 z-10 hidden grid-cols-[minmax(0,20fr)_minmax(0,35fr)_minmax(8rem,15fr)_minmax(0,30fr)] px-4 py-3 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground md:grid ${advPanelHeader} backdrop-blur`}>
        <span>Category</span><span>Expense Item</span><span>Monthly Amount</span><span>Notes</span>
      </div>
      <div className="divide-y divide-border/45">
        {LIVING_EXPENSE_ITEMS.map((item, index) => {
          const startsCategory = index === 0 || LIVING_EXPENSE_ITEMS[index - 1].category !== item.category;
          return <div
            data-testid="expense-row"
            data-category-start={startsCategory || undefined}
            className="grid min-w-0 grid-cols-1 gap-3 px-4 py-3 odd:bg-background/25 transition-colors duration-150 hover:bg-primary/5 focus-within:bg-primary/10 motion-reduce:transition-none md:grid-cols-[minmax(0,20fr)_minmax(0,35fr)_minmax(8rem,15fr)_minmax(0,30fr)] md:items-center md:gap-0"
            key={item.key}
          >
            <div className="min-w-0 md:pr-4">
              <span className="text-xs font-semibold text-muted-foreground md:hidden">Category</span>
              <p className={`break-words text-sm ${startsCategory ? 'font-bold text-foreground' : 'text-muted-foreground'}`}>{item.category}</p>
            </div>
            <div className="min-w-0 md:pr-4">
              <span className="text-xs font-semibold text-muted-foreground md:hidden">Expense Item</span>
              <p className="break-words text-sm font-medium text-foreground">{item.itemLabel}</p>
            </div>
            <label className="block min-w-0 text-xs font-semibold text-muted-foreground md:pr-3">
              <span className="md:sr-only">Monthly Amount</span>
              <input aria-label={`${item.itemLabel} monthly amount`} type="number" min="0" step="0.01" className={`${advField} mt-1 text-right tabular-nums md:mt-0`} {...register(`expenses.${index}.monthlyAmount`, { setValueAs: value => value === '' ? 0 : Number(value) })} />
            </label>
            <label className="block min-w-0 text-xs font-semibold text-muted-foreground">
              <span className="md:sr-only">Notes</span>
              <input aria-label={`${item.itemLabel} notes`} className={`${advField} mt-1 md:mt-0`} {...register(`expenses.${index}.notes`)} />
            </label>
          </div>;
        })}
      </div>
    </section>
  </div>;
}
