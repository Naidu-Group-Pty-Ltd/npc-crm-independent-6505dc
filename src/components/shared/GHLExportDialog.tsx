import { useEffect, useMemo, useState } from 'react';
import { Download, FileSpreadsheet, FileText } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import {
  buildGHLExportRows,
  createDefaultGHLMapping,
  downloadGHLCSV,
  downloadGHLXLSX,
  GHLExportField,
  GHLExportRecord,
  GHL_HEADER_OPTIONS,
  GHLHeaderMapping,
  UNMAPPED_FIELD,
} from '@/lib/ghlExport';

interface GHLExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  fields: GHLExportField[];
  records: GHLExportRecord[];
  fileBaseName: string;
  sheetName: string;
  onExported?: (format: 'csv' | 'xlsx', count: number) => void;
}

export function GHLExportDialog({
  open,
  onOpenChange,
  title,
  description,
  fields,
  records,
  fileBaseName,
  sheetName,
  onExported,
}: GHLExportDialogProps) {
  const [mapping, setMapping] = useState<GHLHeaderMapping>(() => createDefaultGHLMapping(fields));
  const [includeUnmapped, setIncludeUnmapped] = useState(false);

  useEffect(() => {
    if (open) {
      setMapping(createDefaultGHLMapping(fields));
      setIncludeUnmapped(false);
    }
  }, [fields, open]);

  const previewHeaders = useMemo(
    () => buildGHLExportRows({ fields, records: [], mapping, includeUnmapped }).headers,
    [fields, includeUnmapped, mapping],
  );

  const handleExport = (format: 'csv' | 'xlsx') => {
    const { headers, rows } = buildGHLExportRows({ fields, records, mapping, includeUnmapped });
    const safeBaseName = fileBaseName.replace(/[^a-z0-9_-]/gi, '_');

    if (format === 'csv') {
      downloadGHLCSV(`${safeBaseName}.csv`, headers, rows);
    } else {
      downloadGHLXLSX(`${safeBaseName}.xlsx`, sheetName, headers, rows);
    }

    onExported?.(format, rows.length);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
            {records.length} client row{records.length === 1 ? '' : 's'} and {previewHeaders.length} column{previewHeaders.length === 1 ? '' : 's'} will be exported with your selected column mapping.
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {GHL_HEADER_OPTIONS.map((option) => (
              <div key={option.key} className="space-y-2 rounded-md border p-3">
                <div className="flex items-center justify-between gap-2">
                  <Label>{option.label}</Label>
                  {option.required && <span className="text-xs text-muted-foreground">Recommended</span>}
                </div>
                <Select
                  value={mapping[option.key]}
                  onValueChange={(value) => setMapping((prev) => ({ ...prev, [option.key]: value }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choose app field" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={UNMAPPED_FIELD}>Do not include</SelectItem>
                    {fields.map((field) => (
                      <SelectItem key={field.key} value={field.key}>
                        {field.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-3 rounded-md border p-3">
            <Checkbox
              id="include-unmapped-fields"
              checked={includeUnmapped}
              onCheckedChange={(checked) => setIncludeUnmapped(checked === true)}
            />
            <div className="space-y-0.5">
              <Label htmlFor="include-unmapped-fields">Include all other fields after the mapped columns</Label>
              <p className="text-sm text-muted-foreground">Turn this on only if you want additional source columns appended to the export.</p>
            </div>
          </div>

          <Separator />

          <div className="space-y-2">
            <Label>Export preview headers</Label>
            <div className="flex flex-wrap gap-2">
              {previewHeaders.map((header) => (
                <span key={header} className="rounded-md border bg-background px-2 py-1 text-xs text-foreground">
                  {header}
                </span>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleExport('csv')}>
            <FileText className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
          <Button onClick={() => handleExport('xlsx')}>
            <FileSpreadsheet className="h-4 w-4 mr-2" />
            Export XLSX
          </Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            <Download className="h-4 w-4 mr-2" />
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}