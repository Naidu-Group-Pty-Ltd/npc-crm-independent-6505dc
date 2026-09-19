/**
 * TextStylesDialog — manage named Paragraph + Character styles (Section 3).
 *
 * Stored on `template.tokens.paragraphStyles` / `characterStyles`.
 * Text overlays reference them via `styleRef`.
 */
import { useMemo, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Plus, Trash2, Type } from 'lucide-react';
import { toast } from 'sonner';
import type { ReportTemplate, ParagraphStyle, CharacterStyle } from '@/lib/reportTemplate/templateSchema';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  template: ReportTemplate;
  onChange: (next: ReportTemplate) => void;
}

const ALIGN = ['left','center','right','justify'] as const;
const TRANSFORM = ['none','uppercase','lowercase','capitalize','small-caps'] as const;
const DECORATION = ['none','underline','line-through','overline'] as const;

export function TextStylesDialog({ open, onOpenChange, template, onChange }: Props) {
  const [tab, setTab] = useState<'paragraph' | 'character'>('paragraph');
  const paraStyles = useMemo(() => template.tokens.paragraphStyles ?? {}, [template]);
  const charStyles = useMemo(() => template.tokens.characterStyles ?? {}, [template]);
  const [selectedPara, setSelectedPara] = useState<string | null>(null);
  const [selectedChar, setSelectedChar] = useState<string | null>(null);

  const updateTokens = (patch: Partial<ReportTemplate['tokens']>) => {
    onChange({ ...template, tokens: { ...template.tokens, ...patch } });
  };

  const addPara = () => {
    const name = window.prompt('Paragraph style name (e.g. "Body", "Heading 1")')?.trim();
    if (!name) return;
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || crypto.randomUUID();
    if (paraStyles[id]) { toast.error('A style with that id already exists'); return; }
    const next: ParagraphStyle = { id, name, fontSize: 12, lineHeight: 1.3 };
    updateTokens({ paragraphStyles: { ...paraStyles, [id]: next } });
    setSelectedPara(id);
  };
  const removePara = (id: string) => {
    const copy = { ...paraStyles }; delete copy[id];
    updateTokens({ paragraphStyles: copy });
    if (selectedPara === id) setSelectedPara(null);
  };
  const updatePara = (id: string, patch: Partial<ParagraphStyle>) => {
    const cur = paraStyles[id]; if (!cur) return;
    updateTokens({ paragraphStyles: { ...paraStyles, [id]: { ...cur, ...patch } } });
  };

  const addChar = () => {
    const name = window.prompt('Character style name (e.g. "Emphasis", "Code")')?.trim();
    if (!name) return;
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || crypto.randomUUID();
    if (charStyles[id]) { toast.error('A style with that id already exists'); return; }
    const next: CharacterStyle = { id, name };
    updateTokens({ characterStyles: { ...charStyles, [id]: next } });
    setSelectedChar(id);
  };
  const removeChar = (id: string) => {
    const copy = { ...charStyles }; delete copy[id];
    updateTokens({ characterStyles: copy });
    if (selectedChar === id) setSelectedChar(null);
  };
  const updateChar = (id: string, patch: Partial<CharacterStyle>) => {
    const cur = charStyles[id]; if (!cur) return;
    updateTokens({ characterStyles: { ...charStyles, [id]: { ...cur, ...patch } } });
  };

  const cur = selectedPara ? paraStyles[selectedPara] : null;
  const curChar = selectedChar ? charStyles[selectedChar] : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Type className="h-4 w-4" /> Text styles</DialogTitle>
          <DialogDescription>
            Reusable paragraph & character styles. Reference them from any text overlay via the inspector.
          </DialogDescription>
        </DialogHeader>
        <Tabs value={tab} onValueChange={(v) => setTab(v as any)} className="flex-1 flex flex-col min-h-0">
          <TabsList className="self-start">
            <TabsTrigger value="paragraph">Paragraph ({Object.keys(paraStyles).length})</TabsTrigger>
            <TabsTrigger value="character">Character ({Object.keys(charStyles).length})</TabsTrigger>
          </TabsList>
          <TabsContent value="paragraph" className="flex-1 min-h-0">
            <div className="grid grid-cols-[220px_1fr] gap-3 h-full">
              <div className="border rounded flex flex-col min-h-0">
                <div className="p-2 flex items-center justify-between border-b">
                  <span className="text-xs font-semibold">Styles</span>
                  <Button size="icon" variant="ghost" className="h-6 w-6" onClick={addPara}><Plus className="h-3.5 w-3.5" /></Button>
                </div>
                <ScrollArea className="flex-1">
                  {Object.values(paraStyles).map((s) => (
                    <button
                      key={s.id}
                      onClick={() => setSelectedPara(s.id)}
                      className={`w-full text-left px-2 py-1.5 text-xs hover:bg-muted flex items-center justify-between ${selectedPara === s.id ? 'bg-muted' : ''}`}
                    >
                      <span className="truncate">{s.name}</span>
                      <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" onClick={(e) => { e.stopPropagation(); removePara(s.id); }} />
                    </button>
                  ))}
                  {Object.keys(paraStyles).length === 0 && (
                    <p className="text-xs text-muted-foreground p-3 text-center">No styles yet</p>
                  )}
                </ScrollArea>
              </div>
              <ScrollArea className="border rounded p-3">
                {!cur ? (
                  <p className="text-xs text-muted-foreground text-center py-8">Select or add a paragraph style</p>
                ) : (
                  <div className="space-y-3 text-xs">
                    <Row label="Name"><Input className="h-8" value={cur.name} onChange={(e) => updatePara(cur.id, { name: e.target.value })} /></Row>
                    <Row label="Based on">
                      <Select value={cur.basedOn ?? '__none__'} onValueChange={(v) => updatePara(cur.id, { basedOn: v === '__none__' ? undefined : v })}>
                        <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">(none)</SelectItem>
                          {Object.values(paraStyles).filter((s) => s.id !== cur.id).map((s) => (
                            <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Row>
                    <div className="grid grid-cols-2 gap-2">
                      <Row label="Font family"><Input className="h-8" value={cur.fontFamily ?? ''} placeholder="(inherit)" onChange={(e) => updatePara(cur.id, { fontFamily: e.target.value || undefined })} /></Row>
                      <Row label="Font size (pt)"><Input className="h-8" type="number" value={cur.fontSize ?? ''} onChange={(e) => updatePara(cur.id, { fontSize: e.target.value === '' ? undefined : Number(e.target.value) })} /></Row>
                      <Row label="Line height"><Input className="h-8" type="number" step="0.05" value={cur.lineHeight ?? ''} onChange={(e) => updatePara(cur.id, { lineHeight: e.target.value === '' ? undefined : Number(e.target.value) })} /></Row>
                      <Row label="Letter spacing (pt)"><Input className="h-8" type="number" step="0.1" value={cur.letterSpacing ?? ''} onChange={(e) => updatePara(cur.id, { letterSpacing: e.target.value === '' ? undefined : Number(e.target.value) })} /></Row>
                      <Row label="Weight">
                        <Select value={String(cur.fontWeight ?? '__none__')} onValueChange={(v) => updatePara(cur.id, { fontWeight: v === '__none__' ? undefined : (v as any) })}>
                          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">(inherit)</SelectItem>
                            <SelectItem value="normal">normal</SelectItem>
                            <SelectItem value="bold">bold</SelectItem>
                          </SelectContent>
                        </Select>
                      </Row>
                      <Row label="Style">
                        <Select value={cur.fontStyle ?? '__none__'} onValueChange={(v) => updatePara(cur.id, { fontStyle: v === '__none__' ? undefined : (v as any) })}>
                          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">(inherit)</SelectItem>
                            <SelectItem value="normal">normal</SelectItem>
                            <SelectItem value="italic">italic</SelectItem>
                          </SelectContent>
                        </Select>
                      </Row>
                      <Row label="Align">
                        <Select value={cur.align ?? '__none__'} onValueChange={(v) => updatePara(cur.id, { align: v === '__none__' ? undefined : (v as any) })}>
                          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">(inherit)</SelectItem>
                            {ALIGN.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </Row>
                      <Row label="Color"><Input className="h-8" type="color" value={cur.color ?? '#000000'} onChange={(e) => updatePara(cur.id, { color: e.target.value })} /></Row>
                      <Row label="Paragraph spacing (pt)"><Input className="h-8" type="number" value={cur.paragraphSpacing ?? ''} onChange={(e) => updatePara(cur.id, { paragraphSpacing: e.target.value === '' ? undefined : Number(e.target.value) })} /></Row>
                      <Row label="First-line indent (pt)"><Input className="h-8" type="number" value={cur.paragraphIndent ?? ''} onChange={(e) => updatePara(cur.id, { paragraphIndent: e.target.value === '' ? undefined : Number(e.target.value) })} /></Row>
                      <Row label="Transform">
                        <Select value={cur.textTransform ?? '__none__'} onValueChange={(v) => updatePara(cur.id, { textTransform: v === '__none__' ? undefined : (v as any) })}>
                          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">(inherit)</SelectItem>
                            {TRANSFORM.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </Row>
                      <Row label="Decoration">
                        <Select value={cur.textDecoration ?? '__none__'} onValueChange={(v) => updatePara(cur.id, { textDecoration: v === '__none__' ? undefined : (v as any) })}>
                          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">(inherit)</SelectItem>
                            {DECORATION.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </Row>
                      <Row label="Columns"><Input className="h-8" type="number" min={1} max={6} value={cur.columns ?? ''} onChange={(e) => updatePara(cur.id, { columns: e.target.value === '' ? undefined : Number(e.target.value) })} /></Row>
                      <Row label="Column gap (pt)"><Input className="h-8" type="number" value={cur.columnGap ?? ''} onChange={(e) => updatePara(cur.id, { columnGap: e.target.value === '' ? undefined : Number(e.target.value) })} /></Row>
                      <Row label="OpenType features"><Input className="h-8" placeholder='e.g. "ss01" 1, "kern" 1' value={cur.fontFeatureSettings ?? ''} onChange={(e) => updatePara(cur.id, { fontFeatureSettings: e.target.value || undefined })} /></Row>
                      <Row label="Numerals">
                        <Select value={cur.fontVariantNumeric ?? '__none__'} onValueChange={(v) => updatePara(cur.id, { fontVariantNumeric: v === '__none__' ? undefined : (v as any) })}>
                          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">(inherit)</SelectItem>
                            <SelectItem value="normal">normal</SelectItem>
                            <SelectItem value="lining-nums">lining</SelectItem>
                            <SelectItem value="oldstyle-nums">old-style</SelectItem>
                            <SelectItem value="tabular-nums">tabular</SelectItem>
                            <SelectItem value="proportional-nums">proportional</SelectItem>
                          </SelectContent>
                        </Select>
                      </Row>
                    </div>
                    <div className="rounded border p-3 bg-muted/30 mt-2">
                      <div className="text-[10px] text-muted-foreground mb-1">Preview</div>
                      <div style={{
                        fontFamily: cur.fontFamily,
                        fontSize: cur.fontSize ? `${cur.fontSize}pt` : undefined,
                        fontWeight: cur.fontWeight as any,
                        fontStyle: cur.fontStyle,
                        color: cur.color,
                        textAlign: cur.align,
                        lineHeight: cur.lineHeight,
                        letterSpacing: cur.letterSpacing != null ? `${cur.letterSpacing}pt` : undefined,
                        textTransform: cur.textTransform as any,
                        textDecoration: cur.textDecoration,
                        fontFeatureSettings: cur.fontFeatureSettings,
                        fontVariantNumeric: cur.fontVariantNumeric,
                      }}>
                        The quick brown fox jumps over the lazy dog. 0123456789
                      </div>
                    </div>
                  </div>
                )}
              </ScrollArea>
            </div>
          </TabsContent>
          <TabsContent value="character" className="flex-1 min-h-0">
            <div className="grid grid-cols-[220px_1fr] gap-3 h-full">
              <div className="border rounded flex flex-col min-h-0">
                <div className="p-2 flex items-center justify-between border-b">
                  <span className="text-xs font-semibold">Styles</span>
                  <Button size="icon" variant="ghost" className="h-6 w-6" onClick={addChar}><Plus className="h-3.5 w-3.5" /></Button>
                </div>
                <ScrollArea className="flex-1">
                  {Object.values(charStyles).map((s) => (
                    <button
                      key={s.id}
                      onClick={() => setSelectedChar(s.id)}
                      className={`w-full text-left px-2 py-1.5 text-xs hover:bg-muted flex items-center justify-between ${selectedChar === s.id ? 'bg-muted' : ''}`}
                    >
                      <span className="truncate">{s.name}</span>
                      <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" onClick={(e) => { e.stopPropagation(); removeChar(s.id); }} />
                    </button>
                  ))}
                  {Object.keys(charStyles).length === 0 && (
                    <p className="text-xs text-muted-foreground p-3 text-center">No styles yet</p>
                  )}
                </ScrollArea>
              </div>
              <ScrollArea className="border rounded p-3">
                {!curChar ? (
                  <p className="text-xs text-muted-foreground text-center py-8">Select or add a character style</p>
                ) : (
                  <div className="space-y-3 text-xs">
                    <Row label="Name"><Input className="h-8" value={curChar.name} onChange={(e) => updateChar(curChar.id, { name: e.target.value })} /></Row>
                    <div className="grid grid-cols-2 gap-2">
                      <Row label="Font family"><Input className="h-8" value={curChar.fontFamily ?? ''} onChange={(e) => updateChar(curChar.id, { fontFamily: e.target.value || undefined })} /></Row>
                      <Row label="Weight">
                        <Select value={String(curChar.fontWeight ?? '__none__')} onValueChange={(v) => updateChar(curChar.id, { fontWeight: v === '__none__' ? undefined : (v as any) })}>
                          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">(inherit)</SelectItem>
                            <SelectItem value="normal">normal</SelectItem>
                            <SelectItem value="bold">bold</SelectItem>
                          </SelectContent>
                        </Select>
                      </Row>
                      <Row label="Style">
                        <Select value={curChar.fontStyle ?? '__none__'} onValueChange={(v) => updateChar(curChar.id, { fontStyle: v === '__none__' ? undefined : (v as any) })}>
                          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">(inherit)</SelectItem>
                            <SelectItem value="normal">normal</SelectItem>
                            <SelectItem value="italic">italic</SelectItem>
                          </SelectContent>
                        </Select>
                      </Row>
                      <Row label="Color"><Input className="h-8" type="color" value={curChar.color ?? '#000000'} onChange={(e) => updateChar(curChar.id, { color: e.target.value })} /></Row>
                      <Row label="Letter spacing (pt)"><Input className="h-8" type="number" step="0.1" value={curChar.letterSpacing ?? ''} onChange={(e) => updateChar(curChar.id, { letterSpacing: e.target.value === '' ? undefined : Number(e.target.value) })} /></Row>
                      <Row label="Transform">
                        <Select value={curChar.textTransform ?? '__none__'} onValueChange={(v) => updateChar(curChar.id, { textTransform: v === '__none__' ? undefined : (v as any) })}>
                          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">(inherit)</SelectItem>
                            {TRANSFORM.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </Row>
                      <Row label="Decoration">
                        <Select value={curChar.textDecoration ?? '__none__'} onValueChange={(v) => updateChar(curChar.id, { textDecoration: v === '__none__' ? undefined : (v as any) })}>
                          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">(inherit)</SelectItem>
                            {DECORATION.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </Row>
                    </div>
                  </div>
                )}
              </ScrollArea>
            </div>
          </TabsContent>
        </Tabs>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</Label>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}
