/**
 * One template in the list.
 *
 * ## Why the card is the link
 *
 * Every card used to carry a filled "Open editor" button and a red trash icon.
 * On a nine-template grid that is eighteen controls competing for attention,
 * and seventeen of them do the same thing. The card itself is now the link —
 * `after:absolute after:inset-0` on the title anchor stretches its hit area
 * over the whole card while the accessible name stays the template's name — and
 * the destructive action moves into a quiet overflow menu where it belongs.
 *
 * ## The delete dialog is not in here
 *
 * Nesting `AlertDialogTrigger` inside `DropdownMenuItem` loses focus when the
 * menu closes, and it mounts one dialog per card. The menu item raises
 * `onDelete(template)` and the page owns a single controlled dialog.
 */
import { Link } from 'react-router-dom';
import { CheckCircle2, Edit, MoreVertical, Trash2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { getAdapter } from '@/lib/reportTemplate/adapters';
import {
  deleteBlockedReason,
  formatTemplateDate,
  type TemplateRowLike,
} from '@/lib/reportTemplate/templateListControls';

export interface TemplateCardProps {
  template: TemplateRowLike;
  reportTypeLabels: Record<string, string>;
  canEdit: boolean;
  canDelete: boolean;
  onDelete: (template: TemplateRowLike) => void;
}

export function TemplateCard({
  template,
  reportTypeLabels,
  canEdit,
  canDelete,
  onDelete,
}: TemplateCardProps) {
  const adapter = template.report_type ? getAdapter(template.report_type) : null;
  const blocked = deleteBlockedReason(template);
  const href = `/admin/template-builder/${template.id}`;

  return (
    <Card className="relative transition-colors hover:border-primary/40 focus-within:border-primary/60">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <CardTitle className="truncate text-base">
              {canEdit ? (
                <Link
                  to={href}
                  // Stretches over the card without changing the accessible
                  // name. The overflow menu sits above it on the z-axis so its
                  // own clicks are not swallowed.
                  className="after:absolute after:inset-0 after:rounded-lg hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
                >
                  {template.name}
                </Link>
              ) : (
                template.name
              )}
            </CardTitle>
            <CardDescription className="mt-1 line-clamp-2 text-xs">
              {template.description || 'No description'}
            </CardDescription>
            <div className="mt-2 text-[11px] text-muted-foreground">
              Updated {formatTemplateDate(template.updated_at)}
            </div>
          </div>

          <div className="relative z-10 flex shrink-0 items-center gap-1">
            {template.is_active && (
              <Badge variant="default" className="text-xs">
                <CheckCircle2 className="mr-1 h-3 w-3" aria-hidden /> Active
              </Badge>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  aria-label={`Actions for ${template.name}`}
                >
                  <MoreVertical className="h-4 w-4" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem asChild disabled={!canEdit}>
                  <Link to={href}>
                    <Edit className="mr-2 h-4 w-4" aria-hidden />
                    Open editor
                  </Link>
                </DropdownMenuItem>
                {canDelete && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      disabled={!!blocked}
                      title={blocked ?? undefined}
                      onSelect={() => { if (!blocked) onDelete(template); }}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 className="mr-2 h-4 w-4" aria-hidden />
                      Delete template…
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <div className="flex flex-wrap gap-1.5 text-xs">
          {template.report_type && (
            <Badge
              variant={adapter?.supportsProduction ? 'secondary' : 'outline'}
              title={adapter?.supportsProduction
                ? 'Production adapter available'
                : 'Preview-only report type'}
            >
              {adapter?.label || reportTypeLabels[template.report_type] || template.report_type}
              {adapter && !adapter.supportsProduction ? ' · preview-only' : ''}
            </Badge>
          )}
          {template.tier && <Badge variant="outline">{template.tier}</Badge>}
          <Badge variant="outline">v{template.version}</Badge>
          {/* No page-count badge. The list query deliberately omits `schema`
              (import schemas run to hundreds of megabytes and `select('*')`
              timed out), so the old `{tpl.schema && …}` condition could never
              be true and the badge never once rendered. */}
        </div>
      </CardContent>
    </Card>
  );
}
