/**
 * One control where there used to be three buttons.
 *
 * `New template` stays the primary half — it is the common case and it is what
 * the button already did. The other two ways in move behind the chevron, where
 * each gets a sentence explaining what it is *for*, which is the thing they
 * were missing when they sat in the header as bare peers called "Import PDF"
 * and "Converter".
 *
 * The shape follows `common/PdfDownloadSplitButton` (primary + attached chevron)
 * and the labelled category menus in the editor toolbar.
 */
import { ChevronDown, Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  TEMPLATE_START_ROUTES,
  type TemplateStartKey,
} from '@/lib/reportTemplate/templateStartRoutes';

export interface TemplateStartSplitButtonProps {
  onBlank: () => void;
  onImport: () => void;
  onConvert: () => void;
  /** Primary half shows a spinner while a template is being created. */
  pending?: boolean;
  disabled?: boolean;
}

export function TemplateStartSplitButton({
  onBlank,
  onImport,
  onConvert,
  pending,
  disabled,
}: TemplateStartSplitButtonProps) {
  const handlers: Record<TemplateStartKey, () => void> = {
    blank: onBlank,
    import: onImport,
    convert: onConvert,
  };

  // The primary half is `blank`; the menu offers the other two. Listing all
  // three in the menu would make the primary button ambiguous.
  const menuRoutes = TEMPLATE_START_ROUTES.filter((r) => r.key !== 'blank');

  return (
    <div className="inline-flex items-stretch">
      <Button
        type="button"
        onClick={onBlank}
        disabled={disabled || pending}
        className="rounded-r-none"
      >
        {pending
          ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
          : <Plus className="mr-2 h-4 w-4" aria-hidden />}
        New template
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            disabled={disabled || pending}
            aria-label="Other ways to start a template"
            className="rounded-l-none border-l border-l-background/30 px-2"
          >
            <ChevronDown className="h-4 w-4" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-80">
          <DropdownMenuLabel>Start from something you already have</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {menuRoutes.map((route) => {
            const Icon = route.icon;
            return (
              <DropdownMenuItem
                key={route.key}
                // `onSelect`, not `onClick` — Radix closes the menu and returns
                // focus to the trigger on select, which a raw click does not.
                onSelect={() => handlers[route.key]()}
                className="flex-col items-start gap-1 py-2.5"
              >
                <span className="flex items-center gap-2 font-medium">
                  <Icon className="h-4 w-4" aria-hidden />
                  {route.title}
                </span>
                <span className="text-xs text-muted-foreground">{route.body}</span>
                <span className="text-xs">
                  <span className="text-muted-foreground">You get: </span>
                  {route.outcome}
                </span>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
