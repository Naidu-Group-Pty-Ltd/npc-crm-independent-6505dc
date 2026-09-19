/**
 * MasterPagesQuickApply — small popover that lets the user assign a defined
 * pageMaster to a page, or to every page. Lives next to the page row in the
 * Pages panel header.
 */
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { LayoutTemplate, Check } from 'lucide-react';
import type { ReportTemplate } from '@/lib/reportTemplate/templateSchema';

interface Props {
  template: ReportTemplate;
  pageId: string | null;
  onApplyToPage: (masterId: string | null) => void;
  onApplyToAll: (masterId: string | null) => void;
}

export function MasterPagesQuickApply({ template, pageId, onApplyToPage, onApplyToAll }: Props) {
  const masters = Object.values(template.pageMasters ?? {});
  const currentPage = template.pages.find((p) => p.id === pageId);
  const currentMasterId = currentPage?.pageMasterId ?? template.defaultPageMasterId ?? null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px] gap-1">
          <LayoutTemplate className="h-3.5 w-3.5" />
          Master
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2">
        <div className="space-y-1">
          <div className="px-1 py-1 text-[10px] uppercase tracking-wider text-muted-foreground">
            Apply master page
          </div>
          {masters.length === 0 && (
            <p className="text-[11px] text-muted-foreground p-2">
              No masters defined yet. Add one in the Page Masters dialog.
            </p>
          )}
          {masters.map((m) => {
            const active = currentMasterId === m.id;
            return (
              <div key={m.id} className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onApplyToPage(m.id)}
                  disabled={!pageId}
                  className="flex-1 flex items-center gap-2 text-left rounded px-2 py-1.5 text-xs hover:bg-muted disabled:opacity-50"
                >
                  {active
                    ? <Check className="h-3 w-3 text-primary" />
                    : <span className="w-3" />}
                  <span className="truncate">{m.name}</span>
                </button>
                <Button
                  size="sm" variant="ghost" className="h-6 text-[10px] px-1.5"
                  onClick={() => onApplyToAll(m.id)}
                  title="Apply to every page"
                >
                  All
                </Button>
              </div>
            );
          })}
          <div className="border-t pt-1 mt-1">
            <button
              type="button"
              onClick={() => onApplyToPage(null)}
              disabled={!pageId}
              className="w-full text-left rounded px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50"
            >
              Clear master on this page
            </button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
