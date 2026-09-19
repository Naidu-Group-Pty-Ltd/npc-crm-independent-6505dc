import { useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Upload, FileText, Code, Globe, Loader2, CheckCircle2, AlertCircle, FileSpreadsheet, FileType } from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import { parseTemplateContent, readFileAsText, detectFormatFromFile, type ParsedTemplate } from '@/utils/checklistTemplateParser';
import { extractPdfTextClientSide } from '@/lib/pdfClientExtractor';
import { extractDocxText } from '@/lib/documentText/docxText';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';

interface TemplateImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (template: ParsedTemplate) => Promise<void>;
}

type ImportStep = 'input' | 'preview' | 'importing';

export function TemplateImportDialog({ open, onOpenChange, onImport }: TemplateImportDialogProps) {
  const [step, setStep] = useState<ImportStep>('input');
  const [pasteContent, setPasteContent] = useState('');
  const [parsedTemplate, setParsedTemplate] = useState<ParsedTemplate | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState('');
  

  const reset = () => {
    setStep('input');
    setPasteContent('');
    setParsedTemplate(null);
    setParseError(null);
    setIsProcessing(false);
    setProgress(0);
    setProgressLabel('');
  };

  const handleClose = (val: boolean) => {
    if (!val) reset();
    onOpenChange(val);
  };

  // ── Parse pasted content ──
  const handleParsePaste = () => {
    if (!pasteContent.trim()) return;
    try {
      setParseError(null);
      const result = parseTemplateContent(pasteContent);
      setParsedTemplate(result);
      setStep('preview');
    } catch (e: any) {
      setParseError(e.message);
    }
  };

  // ── Handle file processing ──
  const processFile = useCallback(async (file: File) => {
    setIsProcessing(true);
    setParseError(null);
    setProgress(0);

    try {
      const format = detectFormatFromFile(file);
      let textContent = '';

      if (format === 'pdf') {
        setProgressLabel('Extracting text from PDF...');
        // Page markers would be parsed as checklist items, so they stay off here.
        const result = await extractPdfTextClientSide(
          file,
          (current, total) => setProgress(Math.round((current / total) * 100)),
          { includePageMarkers: false },
        );
        if (result.likelyNeedsOcr) {
          throw new Error(
            'This PDF has no usable text layer (it looks scanned). Export it as text, or copy the checklist into the paste tab.',
          );
        }
        if (result.failedPages.length > 0) {
          toast.warning(`Page${result.failedPages.length > 1 ? 's' : ''} ${result.failedPages.join(', ')} could not be read and ${result.failedPages.length > 1 ? 'were' : 'was'} skipped.`);
        }
        textContent = result.text;
      } else if (format === 'docx') {
        setProgressLabel('Reading Word document...');
        textContent = await extractDocxText(file);
        setProgress(100);
      } else if (format === 'xlsx') {
        setProgressLabel('Reading spreadsheet...');
        textContent = await extractXlsxText(file);
        setProgress(100);
      } else {
        setProgressLabel('Reading file...');
        textContent = await readFileAsText(file);
        setProgress(100);
      }

      if (!textContent || textContent.trim().length < 10) {
        throw new Error('Could not extract sufficient text from the file. The file may be empty or in an unsupported format.');
      }

      setProgressLabel('Parsing checklist structure...');
      const textFormat = format === 'pdf' || format === 'docx' ? 'markdown' : format === 'xlsx' ? 'text' : format;
      const parsed = parseTemplateContent(textContent, textFormat as any);
      setParsedTemplate(parsed);
      setStep('preview');
    } catch (e: any) {
      setParseError(e.message);
    } finally {
      setIsProcessing(false);
      setProgressLabel('');
    }
  }, []);

  // ── Dropzone ──
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: (files) => {
      if (files.length > 0) processFile(files[0]);
    },
    accept: {
      'application/json': ['.json'],
      'text/markdown': ['.md', '.markdown'],
      'text/html': ['.html', '.htm'],
      'text/plain': ['.txt'],
      'application/pdf': ['.pdf'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.ms-excel': ['.xls'],
    },
    maxFiles: 1,
    disabled: isProcessing,
  });

  // ── Import ──
  const handleImport = async () => {
    if (!parsedTemplate) return;
    setStep('importing');
    try {
      await onImport(parsedTemplate);
      handleClose(false);
      toast.success(`Template "${parsedTemplate.name}" imported with ${parsedTemplate.sections.length} sections`);
    } catch (e: any) {
      toast.error(`Import failed: ${e.message}`);
      setStep('preview');
    }
  };

  const totalItems = parsedTemplate?.sections.reduce((sum, s) => sum + s.items.length, 0) || 0;
  const preCheckedItems = parsedTemplate?.sections.reduce((sum, s) => sum + s.items.filter(i => i.is_pre_checked).length, 0) || 0;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-h-[min(85vh,760px)] w-[calc(100vw-2rem)] max-w-2xl overflow-y-auto rounded-3xl overscroll-contain [scrollbar-color:rgba(245,158,11,0.35)_rgba(24,24,27,0.72)] border-brand-500/15 bg-[radial-gradient(circle_at_top_right,rgba(245,158,11,0.14),transparent_34%),linear-gradient(180deg,#09090b,#030303)] text-foreground dark:text-foreground shadow-2xl shadow-sm dark:shadow-black/40 sm:w-auto">
        <DialogHeader className="space-y-2">
          <DialogTitle className="text-xl font-bold tracking-tight text-foreground dark:text-foreground sm:text-2xl">
            {step === 'input' && 'Import Checklist Template'}
            {step === 'preview' && 'Preview Template'}
            {step === 'importing' && 'Importing...'}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground dark:text-muted-foreground">
            {step === 'input' && 'Upload a file or paste content in any supported format'}
            {step === 'preview' && 'Review the parsed template before importing'}
          </DialogDescription>
        </DialogHeader>

        {/* ── Step 1: Input ── */}
        {step === 'input' && (
          <div className="space-y-4">
            {/* Supported formats */}
            <div className="flex flex-wrap gap-1.5">
              {[
                { label: 'Markdown', icon: FileText },
                { label: 'JSON', icon: Code },
                { label: 'HTML', icon: Globe },
                { label: 'PDF', icon: FileType },
                { label: 'Word (.docx)', icon: FileText },
                { label: 'Excel', icon: FileSpreadsheet },
                { label: 'Plain Text', icon: FileText },
              ].map(f => (
                <Badge key={f.label} variant="outline" className="gap-1 rounded-full border-brand-300/20 bg-brand-300/10 px-2 py-1 text-[10px] font-normal text-brand-100">
                  <f.icon className="h-2.5 w-2.5" />
                  {f.label}
                </Badge>
              ))}
            </div>

            <Tabs defaultValue="upload" className="w-full">
              <TabsList className="grid w-full grid-cols-1 sm:grid-cols-2 rounded-2xl border border-border dark:border-white/5 bg-background dark:bg-black/60 p-1">
                <TabsTrigger value="upload" className="min-h-11 rounded-xl transition-all duration-200 hover:bg-white/5 hover:text-brand-100 focus-visible:ring-2 focus-visible:ring-brand-300/60 data-[state=active]:bg-gradient-to-r data-[state=active]:from-brand-500 data-[state=active]:to-brand-400 data-[state=active]:text-black motion-reduce:transition-none">Upload File</TabsTrigger>
                <TabsTrigger value="paste" className="min-h-11 rounded-xl transition-all duration-200 hover:bg-white/5 hover:text-brand-100 focus-visible:ring-2 focus-visible:ring-brand-300/60 data-[state=active]:bg-gradient-to-r data-[state=active]:from-brand-500 data-[state=active]:to-brand-400 data-[state=active]:text-black motion-reduce:transition-none">Paste Content</TabsTrigger>
              </TabsList>

              <TabsContent value="upload" className="mt-3">
                <div
                  {...getRootProps()}
                  className={`relative cursor-pointer rounded-2xl border-2 border-dashed p-6 text-center shadow-inner shadow-sm dark:shadow-black/30 transition-all sm:p-8
                    ${isDragActive ? 'border-brand-300/70 bg-brand-400/10 shadow-brand-500/10' : 'border-brand-500/25 bg-background dark:bg-black/30 hover:border-brand-300/55 hover:bg-brand-400/10'}
                    ${isProcessing ? 'pointer-events-none opacity-60' : ''}`}
                >
                  <input {...getInputProps()} />
                  {!isProcessing && (
                    <input
                      type="file"
                      accept=".json,.md,.markdown,.html,.htm,.txt,.pdf,.docx,.xlsx,.xls,application/json,text/markdown,text/html,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) processFile(file);
                        e.currentTarget.value = '';
                      }}
                      aria-label="Browse checklist template files"
                      className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0 sm:hidden"
                    />
                  )}
                  {isProcessing ? (
                    <div className="mx-auto max-w-sm space-y-4 rounded-2xl border border-brand-300/15 bg-background dark:bg-black/35 p-5 shadow-inner shadow-brand-950/20">
                      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-brand-300/25 bg-brand-400/10 text-brand-200">
                        <Loader2 className="h-7 w-7 animate-spin" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-foreground dark:text-foreground">{progressLabel}</p>
                        <p className="mt-1 text-xs text-muted-foreground dark:text-muted-foreground">Reading and validating the template file</p>
                      </div>
                      <Progress value={progress} className="mx-auto h-2.5 max-w-xs bg-muted dark:bg-background [&>div]:bg-gradient-to-r [&>div]:from-brand-500 [&>div]:to-brand-300" />
                    </div>
                  ) : (
                    <>
                      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-brand-300/20 bg-brand-400/10 text-brand-200 shadow-[0_18px_40px_rgba(245,158,11,0.14)]">
                        <Upload className="h-7 w-7" />
                      </div>
                      <p className="text-sm font-semibold text-foreground dark:text-foreground">Drop a file here or tap to browse</p>
                      <p className="mt-1 text-xs text-muted-foreground dark:text-muted-foreground">
                        .md, .json, .html, .pdf, .docx, .xlsx, .txt
                      </p>
                    </>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="paste" className="mt-3 space-y-3">
                <Textarea
                  rows={12}
                  placeholder={`Paste your checklist in any format:\n\n## Daily Operations\n\n### Start of the Day\n- [ ] Check emails\n- [ ] Review pipeline\n- [x] Update tracker\n\nOr JSON: { "name": "...", "sections": [...] }\nOr HTML: <h2>Section</h2><ul><li>Item</li></ul>`}
                  value={pasteContent}
                  onChange={e => setPasteContent(e.target.value)}
                  className="max-h-[42vh] min-h-72 overflow-y-auto [scrollbar-color:rgba(245,158,11,0.35)_rgba(24,24,27,0.72)] border-brand-500/15 bg-background dark:bg-black/35 font-mono text-xs text-foreground dark:text-foreground placeholder:text-muted-foreground dark:placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-brand-300/45 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
                />
                <Button onClick={handleParsePaste} disabled={!pasteContent.trim()} className="min-h-11 w-full bg-gradient-to-r from-brand-500 to-brand-400 font-semibold text-black transition-all duration-200 hover:-translate-y-0.5 hover:from-brand-400 hover:to-brand-300 hover:shadow-[0_14px_30px_rgba(245,158,11,0.24)] focus-visible:ring-2 focus-visible:ring-brand-300/70 motion-reduce:transition-none">
                  Parse Content
                </Button>
              </TabsContent>
            </Tabs>

            {parseError && (
              <div className="flex items-start gap-3 rounded-2xl border border-destructive/25 bg-destructive/10 p-4 text-sm text-destructive shadow-inner shadow-destructive/10">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-destructive/25 bg-destructive/10">
                  <AlertCircle className="h-4 w-4" />
                </span>
                <div>
                  <p className="font-semibold">Import needs attention</p>
                  <p className="mt-1 text-destructive/90">{parseError}</p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Step 2: Preview ── */}
        {step === 'preview' && parsedTemplate && (
          <div className="space-y-4">
            {/* Editable name & icon */}
            <div className="space-y-3 rounded-2xl border border-brand-500/10 bg-background dark:bg-black/35 p-4 shadow-inner shadow-brand-950/10">
              <div className="flex gap-3">
                <div className="w-20">
                  <Label className="text-xs text-muted-foreground dark:text-muted-foreground">Icon</Label>
                  <Input
                    value={parsedTemplate.icon}
                    onChange={e => setParsedTemplate({ ...parsedTemplate, icon: e.target.value })}
                    className="border-brand-500/15 bg-background dark:bg-black/35 text-center text-xl text-foreground dark:text-foreground focus-visible:ring-2 focus-visible:ring-brand-300/45 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
                  />
                </div>
                <div className="flex-1">
                  <Label className="text-xs text-muted-foreground dark:text-muted-foreground">Template Name</Label>
                  <Input
                    value={parsedTemplate.name}
                    onChange={e => setParsedTemplate({ ...parsedTemplate, name: e.target.value })}
                    placeholder="e.g. Daily Operations Checklist"
                    className="border-brand-500/15 bg-background dark:bg-black/35 text-foreground dark:text-foreground focus-visible:ring-2 focus-visible:ring-brand-300/45 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
                  />
                </div>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground dark:text-muted-foreground">Description (optional)</Label>
                <Input
                  value={parsedTemplate.description || ''}
                  onChange={e => setParsedTemplate({ ...parsedTemplate, description: e.target.value || undefined })}
                  placeholder="What is this checklist for?"
                  className="border-brand-500/15 bg-background dark:bg-black/35 text-foreground dark:text-foreground focus-visible:ring-2 focus-visible:ring-brand-300/45 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
                />
              </div>
              <div className="flex gap-2">
                <Badge variant="secondary" className="rounded-full border border-brand-300/20 bg-brand-400/10 text-[10px] text-brand-200">{parsedTemplate.sections.length} sections</Badge>
                <Badge variant="secondary" className="rounded-full border border-brand-300/20 bg-brand-400/10 text-[10px] text-brand-200">{totalItems} items</Badge>
                {preCheckedItems > 0 && (
                  <Badge variant="outline" className="rounded-full border-success/20 bg-success/10 text-[10px] text-success">{preCheckedItems} pre-checked</Badge>
                )}
              </div>
            </div>

            {/* Sections preview */}
            <div className="max-h-[40vh] space-y-2 overflow-y-auto overscroll-contain pr-1 [scrollbar-color:rgba(245,158,11,0.35)_rgba(24,24,27,0.72)]">
              {parsedTemplate.sections.map((section, si) => (
                <Card key={si} className="rounded-2xl border-brand-500/10 bg-background dark:bg-background/80 shadow-lg shadow-sm dark:shadow-black/20">
                  <CardContent className="px-4 py-3">
                    <div className="flex items-center gap-2 mb-2">
                      <span>{section.icon}</span>
                      <h4 className="text-sm font-semibold text-foreground dark:text-foreground">{section.title}</h4>
                      <Badge variant="outline" className="ml-auto rounded-full border-brand-300/20 bg-brand-300/10 text-[10px] text-brand-200">{section.items.length} items</Badge>
                    </div>
                    <div className="space-y-1">
                      {section.items.map((item, ii) => (
                        <div key={ii} className="flex items-center gap-2 text-xs text-muted-foreground dark:text-muted-foreground">
                          <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0
                            ${item.is_pre_checked ? 'border-success/30 bg-success/60 text-black' : 'border-brand-300/40'}`}>
                            {item.is_pre_checked && <CheckCircle2 className="h-2.5 w-2.5" />}
                          </div>
                          <span className={item.is_pre_checked ? 'text-foreground dark:text-foreground' : ''}>{item.label}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* ── Step 3: Importing ── */}
        {step === 'importing' && (
          <div className="py-8 text-center">
            <div className="mx-auto max-w-sm space-y-4 rounded-2xl border border-brand-300/15 bg-background dark:bg-black/35 p-5 shadow-inner shadow-brand-950/20">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-brand-300/25 bg-brand-400/10 text-brand-200">
                <Loader2 className="h-7 w-7 animate-spin" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground dark:text-foreground">Creating template and items...</p>
                <p className="mt-1 text-xs text-muted-foreground dark:text-muted-foreground">Saving the imported blueprint to Templates</p>
              </div>
            </div>
          </div>
        )}

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          {step === 'input' && (
            <Button variant="ghost" className="min-h-10 w-full text-muted-foreground dark:text-foreground transition-all sm:w-auto duration-200 hover:bg-white/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand-300/55 motion-reduce:transition-none" onClick={() => handleClose(false)}>Cancel</Button>
          )}
          {step === 'preview' && (
            <>
              <Button variant="ghost" className="min-h-10 w-full text-muted-foreground dark:text-foreground transition-all sm:w-auto duration-200 hover:bg-white/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand-300/55 motion-reduce:transition-none" onClick={() => { setStep('input'); setParsedTemplate(null); }}>
                ← Back
              </Button>
              <Button onClick={handleImport} className="min-h-10 w-full bg-gradient-to-r from-brand-500 to-brand-400 sm:w-auto font-semibold text-black transition-all duration-200 hover:-translate-y-0.5 hover:from-brand-400 hover:to-brand-300 hover:shadow-[0_14px_30px_rgba(245,158,11,0.24)] focus-visible:ring-2 focus-visible:ring-brand-300/70 motion-reduce:transition-none">
                Import {totalItems} Items
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Excel text extraction ──
async function extractXlsxText(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });
  const lines: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });
    
    if (workbook.SheetNames.length > 1) {
      lines.push(`## ${sheetName}`);
    }

    let lastSection = '';
    for (const row of data) {
      if (!row || row.length === 0) continue;
      const firstCell = String(row[0] || '').trim();
      if (!firstCell) continue;

      // Heuristic: if row has only one cell and it's short text, treat as section
      const nonEmpty = row.filter(c => c && String(c).trim());
      if (nonEmpty.length === 1 && firstCell.length < 80 && !firstCell.match(/^[-*☐☑✓✔\[]/)) {
        lines.push(`### ${firstCell}`);
        lastSection = firstCell;
      } else {
        // Check for checkbox-like values in second column
        const status = row.length > 1 ? String(row[1] || '').trim().toLowerCase() : '';
        const isChecked = ['yes', 'done', 'complete', 'true', 'x', '✓', '✔', '☑'].includes(status);
        lines.push(isChecked ? `- [x] ${firstCell}` : `- [ ] ${firstCell}`);
      }
    }
  }

  return lines.join('\n');
}
