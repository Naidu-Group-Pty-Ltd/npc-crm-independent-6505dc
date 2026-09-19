/**
 * PrepareForSigningModal — visual DocuSign tab placer.
 *
 * Renders the PDF page-by-page (pdf.js), lets the user pick a recipient,
 * drag-drop DocuSign field types from a palette onto pages, configure
 * each tab in an inspector, then save layout or send envelope.
 *
 * Coordinates are stored in PDF points (top-left origin per page) so
 * the edge function passes them straight to DocuSign's xPosition/yPosition.
 */
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Loader2, Plus, Send, Save, Trash2, X, Users, MousePointer2, Undo2, Redo2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { loadPdfjs as getPdfJs } from '@/lib/pdf/pdfjs';

export type SigningTabType =
  | 'signature' | 'initial' | 'dateSigned'
  | 'fullName' | 'firstName' | 'lastName' | 'emailAddress'
  | 'title' | 'company'
  | 'text' | 'number' | 'checkbox'
  | 'note' | 'approve' | 'decline';

export interface SigningRecipient {
  id: string;
  name: string;
  email: string;
  roleLabel?: string;
  routingOrder?: number;
  /** 'sender' = the agency/internal party sending the envelope; 'recipient' = external signer (default). */
  party?: 'sender' | 'recipient';
}

export interface SigningTab {
  id: string;
  recipientId: string;
  type: SigningTabType;
  page: number;
  x: number;
  y: number;
  width?: number;
  height?: number;
  required?: boolean;
  label?: string;
  defaultValue?: string;
  locked?: boolean;
}

const FIELD_CATALOG: Array<{ type: SigningTabType; label: string; defaultW: number; defaultH: number; group: string }> = [
  { type: 'signature',    label: 'Signature',     defaultW: 120, defaultH: 30, group: 'Signing' },
  { type: 'initial',      label: 'Initial',       defaultW: 50,  defaultH: 30, group: 'Signing' },
  { type: 'dateSigned',   label: 'Date Signed',   defaultW: 80,  defaultH: 14, group: 'Signing' },
  { type: 'approve',      label: 'Approve',       defaultW: 80,  defaultH: 24, group: 'Signing' },
  { type: 'decline',      label: 'Decline',       defaultW: 80,  defaultH: 24, group: 'Signing' },
  { type: 'fullName',     label: 'Full Name',     defaultW: 140, defaultH: 14, group: 'Identity' },
  { type: 'firstName',    label: 'First Name',    defaultW: 100, defaultH: 14, group: 'Identity' },
  { type: 'lastName',     label: 'Last Name',     defaultW: 100, defaultH: 14, group: 'Identity' },
  { type: 'emailAddress', label: 'Email',         defaultW: 160, defaultH: 14, group: 'Identity' },
  { type: 'title',        label: 'Title',         defaultW: 120, defaultH: 14, group: 'Identity' },
  { type: 'company',      label: 'Company',       defaultW: 140, defaultH: 14, group: 'Identity' },
  { type: 'text',         label: 'Text',          defaultW: 120, defaultH: 18, group: 'Input' },
  { type: 'number',       label: 'Number',        defaultW: 80,  defaultH: 18, group: 'Input' },
  { type: 'checkbox',     label: 'Checkbox',      defaultW: 14,  defaultH: 14, group: 'Input' },
  { type: 'note',         label: 'Note',          defaultW: 160, defaultH: 40, group: 'Input' },
];

const RECIPIENT_COLORS = [
  'hsl(200 70% 55%)',  // blue
  'hsl(140 50% 50%)',  // green
  'hsl(0 70% 60%)',    // red
  'hsl(280 60% 60%)',  // purple
  'hsl(30 80% 55%)',   // orange
  'hsl(180 60% 45%)',  // teal
];
const SENDER_COLOR = 'hsl(45 80% 55%)'; // gold — reserved for the sender

interface PageDim { width: number; height: number; renderScale: number; }

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** 'agreement' → manage-agency-agreements; 'document' → manage-generated-documents */
  scope: 'agreement' | 'document';
  /** record id */
  recordId: string;
  /** display title for header */
  title: string;
  /** signed URL or blob for the PDF to display */
  pdfUrl: string;
  /** storage bucket override (document scope only) */
  bucket?: string;
  /** initial recipients (prefilled from existing record) */
  initialRecipients?: SigningRecipient[];
  /** initial layout (for edit/reopen) */
  initialLayout?: SigningTab[];
  onSent?: (envelopeId: string) => void;
}

function uid() { return Math.random().toString(36).slice(2, 10); }

export function PrepareForSigningModal({
  open, onOpenChange, scope, recordId, title, pdfUrl, bucket,
  initialRecipients = [], initialLayout = [], onSent,
}: Props) {
  const [recipients, setRecipients] = useState<SigningRecipient[]>(initialRecipients);
  const [tabs, setTabs] = useState<SigningTab[]>(initialLayout);
  const [activeRecipientId, setActiveRecipientId] = useState<string>(initialRecipients[0]?.id || '');
  const [activeFieldType, setActiveFieldType] = useState<SigningTabType | null>(null);
  const [selectedTabId, setSelectedTabId] = useState<string | null>(null);
  const [pages, setPages] = useState<PageDim[]>([]);
  const [loadingPdf, setLoadingPdf] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'save' | 'send' | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Undo/redo history of tab snapshots
  const undoStackRef = useRef<SigningTab[][]>([]);
  const redoStackRef = useRef<SigningTab[][]>([]);
  const [historyVersion, setHistoryVersion] = useState(0);
  const isDraggingRef = useRef(false);

  const commitTabs = useCallback((updater: SigningTab[] | ((prev: SigningTab[]) => SigningTab[])) => {
    setTabs(prev => {
      const next = typeof updater === 'function' ? (updater as (p: SigningTab[]) => SigningTab[])(prev) : updater;
      undoStackRef.current.push(prev);
      if (undoStackRef.current.length > 50) undoStackRef.current.shift();
      redoStackRef.current = [];
      setHistoryVersion(v => v + 1);
      return next;
    });
  }, []);

  const undo = useCallback(() => {
    if (!undoStackRef.current.length) return;
    setTabs(prev => {
      const previous = undoStackRef.current.pop()!;
      redoStackRef.current.push(prev);
      setHistoryVersion(v => v + 1);
      return previous;
    });
  }, []);

  const redo = useCallback(() => {
    if (!redoStackRef.current.length) return;
    setTabs(prev => {
      const next = redoStackRef.current.pop()!;
      undoStackRef.current.push(prev);
      setHistoryVersion(v => v + 1);
      return next;
    });
  }, []);

  // Reset when record changes
  useEffect(() => {
    if (open) {
      setRecipients(initialRecipients);
      setPdfError(null);
      setActionError(null);
      setTabs(initialLayout);
      setActiveRecipientId(initialRecipients[0]?.id || '');
      setActiveFieldType(null);
      setSelectedTabId(null);
      undoStackRef.current = [];
      redoStackRef.current = [];
      setHistoryVersion(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, recordId]);

  // Keyboard shortcuts for undo/redo (only while modal is open)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, undo, redo]);

  // Render PDF pages to canvases
  useEffect(() => {
    if (!open || !pdfUrl) return;
    let cancelled = false;
    setLoadingPdf(true);
    setPdfError(null);
    (async () => {
      try {
        const pdfjs = await getPdfJs();
        const loadingTask = pdfjs.getDocument(pdfUrl);
        const pdf = await loadingTask.promise;
        const dims: PageDim[] = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          if (cancelled) return;
          const page = await pdf.getPage(i);
          // Render at 1.5x for crisp display; we record PDF-point coords (no scale factor needed in storage)
          const RENDER_SCALE = 1.5;
          const viewport = page.getViewport({ scale: RENDER_SCALE });
          const canvas = document.getElementById(`pfsm-page-${i}`) as HTMLCanvasElement | null;
          if (!canvas) {
            dims.push({ width: page.view[2], height: page.view[3], renderScale: RENDER_SCALE });
            continue;
          }
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise;
          // PDF point dims = page.view[2], page.view[3] (default user space units)
          dims.push({ width: page.view[2], height: page.view[3], renderScale: RENDER_SCALE });
        }
        if (!cancelled) {
          // Two-pass: setPages first so canvases mount, then render again
          setPages(Array(pdf.numPages).fill({ width: 612, height: 792, renderScale: 1.5 }));
          // schedule actual render after canvases exist
          setTimeout(async () => {
            const dims2: PageDim[] = [];
            for (let i = 1; i <= pdf.numPages; i++) {
              const page = await pdf.getPage(i);
              const RENDER_SCALE = 1.5;
              const viewport = page.getViewport({ scale: RENDER_SCALE });
              const canvas = document.getElementById(`pfsm-page-${i}`) as HTMLCanvasElement | null;
              if (canvas) {
                canvas.width = viewport.width;
                canvas.height = viewport.height;
                await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise;
              }
              dims2.push({ width: page.view[2], height: page.view[3], renderScale: RENDER_SCALE });
            }
            if (!cancelled) setPages(dims2);
          }, 0);
        }
      } catch (e: any) {
        setPdfError(e.message || 'Failed to load PDF');
        toast.error(`Failed to load PDF: ${e.message}`);
      } finally {
        if (!cancelled) setLoadingPdf(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, pdfUrl]);

  // Split recipients into sender (max 1) and external recipients for UI sections.
  const senderRecipient = useMemo(() => recipients.find(r => r.party === 'sender') || null, [recipients]);
  const externalRecipients = useMemo(() => recipients.filter(r => r.party !== 'sender'), [recipients]);

  const colorFor = useCallback((recipientId: string) => {
    const r = recipients.find(x => x.id === recipientId);
    if (!r) return RECIPIENT_COLORS[0];
    if (r.party === 'sender') return SENDER_COLOR;
    const idx = externalRecipients.findIndex(x => x.id === recipientId);
    return RECIPIENT_COLORS[idx % RECIPIENT_COLORS.length] || RECIPIENT_COLORS[0];
  }, [recipients, externalRecipients]);

  const activeColor = useMemo(() => {
    return activeRecipientId ? colorFor(activeRecipientId) : RECIPIENT_COLORS[0];
  }, [activeRecipientId, colorFor]);

  // Click-on-page to place an active field
  const handlePageClick = (pageIdx: number, evt: React.MouseEvent<HTMLDivElement>) => {
    // Suppress placement if a drag just finished
    if (isDraggingRef.current) return;
    if (!activeFieldType || !activeRecipientId) return;
    // Ignore clicks that originated on an existing tab overlay
    if ((evt.target as HTMLElement).closest('[data-signing-tab]')) return;
    const dim = pages[pageIdx];
    if (!dim) return;
    const rect = evt.currentTarget.getBoundingClientRect();
    const xCss = evt.clientX - rect.left;
    const yCss = evt.clientY - rect.top;
    const scaleX = dim.width / rect.width;
    const scaleY = dim.height / rect.height;
    const xPt = xCss * scaleX;
    const yPt = yCss * scaleY;
    const fieldDef = FIELD_CATALOG.find(f => f.type === activeFieldType)!;
    const tab: SigningTab = {
      id: uid(),
      recipientId: activeRecipientId,
      type: activeFieldType,
      page: pageIdx + 1,
      x: xPt,
      y: yPt,
      width: fieldDef.defaultW,
      height: fieldDef.defaultH,
      required: true,
    };
    commitTabs(prev => [...prev, tab]);
    setSelectedTabId(tab.id);
    setActiveFieldType(null);
  };

  const updateTab = (id: string, patch: Partial<SigningTab>) => {
    commitTabs(prev => prev.map(t => t.id === id ? { ...t, ...patch } : t));
  };
  const deleteTab = (id: string) => {
    commitTabs(prev => prev.filter(t => t.id !== id));
    if (selectedTabId === id) setSelectedTabId(null);
  };

  // Pointer-drag to move an existing tab (touch + mouse + pen)
  const DRAG_THRESHOLD_PX = 5;
  const beginTabDrag = (
    e: React.PointerEvent<HTMLDivElement>,
    tab: SigningTab,
    pageEl: HTMLElement,
    dim: PageDim,
  ) => {
    // Only primary button for mouse; allow touch/pen always
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    setSelectedTabId(tab.id);

    const target = e.currentTarget as HTMLDivElement;
    const pointerId = e.pointerId;
    try { target.setPointerCapture(pointerId); } catch { /* noop */ }

    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const startX = tab.x;
    const startY = tab.y;
    const rect = pageEl.getBoundingClientRect();
    const scaleX = dim.width / rect.width;
    const scaleY = dim.height / rect.height;
    let dragging = false;
    let lastX = startX;
    let lastY = startY;
    let rafId: number | null = null;

    const flush = () => {
      rafId = null;
      setTabs(prev => prev.map(t => t.id === tab.id ? { ...t, x: lastX, y: lastY } : t));
    };

    const onMove = (ev: PointerEvent) => {
      const totalDx = ev.clientX - startClientX;
      const totalDy = ev.clientY - startClientY;
      if (!dragging) {
        if (Math.hypot(totalDx, totalDy) < DRAG_THRESHOLD_PX) return;
        dragging = true;
        isDraggingRef.current = true;
        // Snapshot the pre-drag state so the entire drag is one undo step
        undoStackRef.current.push(tabs);
        if (undoStackRef.current.length > 50) undoStackRef.current.shift();
        redoStackRef.current = [];
      }
      const w = tab.width || 80;
      const h = tab.height || 20;
      lastX = Math.max(0, Math.min(dim.width - w, startX + totalDx * scaleX));
      lastY = Math.max(0, Math.min(dim.height - h, startY + totalDy * scaleY));
      if (rafId === null) rafId = requestAnimationFrame(flush);
    };

    const cleanup = () => {
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onUp);
      try { target.releasePointerCapture(pointerId); } catch { /* noop */ }
    };

    const onUp = () => {
      if (rafId !== null) { cancelAnimationFrame(rafId); flush(); }
      cleanup();
      if (dragging) {
        setHistoryVersion(v => v + 1);
        // Swallow the trailing click so the page-click placer doesn't fire
        const stop = (cev: MouseEvent) => { cev.stopPropagation(); cev.preventDefault(); };
        window.addEventListener('click', stop, { capture: true, once: true });
        // Release drag-suppression after the synthetic click cycle
        setTimeout(() => { isDraggingRef.current = false; }, 0);
      }
    };

    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onUp);
  };

  const addRecipient = () => {
    const r: SigningRecipient = { id: uid(), name: '', email: '', routingOrder: 1, roleLabel: '', party: 'recipient' };
    setRecipients(prev => [...prev, r]);
    setActiveRecipientId(r.id);
  };
  const addSender = () => {
    if (senderRecipient) {
      setActiveRecipientId(senderRecipient.id);
      return;
    }
    const r: SigningRecipient = { id: uid(), name: '', email: '', routingOrder: 1, roleLabel: 'Sender', party: 'sender' };
    setRecipients(prev => [r, ...prev]);
    setActiveRecipientId(r.id);
  };
  const updateRecipient = (id: string, patch: Partial<SigningRecipient>) => {
    setRecipients(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));
  };
  const removeRecipient = (id: string) => {
    setRecipients(prev => prev.filter(r => r.id !== id));
    commitTabs(prev => prev.filter(t => t.recipientId !== id));
  };

  const callFn = async (action: 'save_signing_layout' | 'send_freeform') => {
    setBusy(action === 'save_signing_layout' ? 'save' : 'send');
    setActionError(null);
    try {
      const fn = scope === 'agreement' ? 'manage-agency-agreements' : 'manage-generated-documents';
      const payload: any = scope === 'agreement'
        ? { action, agreement_id: recordId, signing_recipients: recipients, signing_layout: tabs }
        : { action, id: recordId, signing_recipients: recipients, signing_layout: tabs, bucket };
      const { data, error } = await invokeSecureFunction<any>(fn, payload);
      if (error) throw new Error(error.message);
      if (data?.success === false) throw new Error(data.error || 'Failed');
      if (action === 'send_freeform') {
        toast.success('Envelope sent for signature');
        onSent?.(data.envelope_id);
        onOpenChange(false);
      } else {
        toast.success('Signing layout saved');
      }
    } catch (e: any) {
      setActionError(e.message || 'Failed');
      toast.error(e.message || 'Failed');
    } finally {
      setBusy(null);
    }
  };

  const selectedTab = tabs.find(t => t.id === selectedTabId);
  const groups = Array.from(new Set(FIELD_CATALOG.map(f => f.group)));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] w-[1400px] h-[90vh] p-0 flex flex-col">
        <DialogHeader className="px-4 py-3 border-b">
          <DialogTitle className="text-base flex items-center gap-2">
            <MousePointer2 className="h-4 w-4" />
            Prepare for Signing — {title}
          </DialogTitle>
        </DialogHeader>

        {(loadingPdf || pdfError || actionError) && (
          <div className={`border-b px-4 py-3 text-sm ${pdfError || actionError ? 'border-destructive/25 bg-destructive/8 text-destructive dark:text-destructive' : 'border-brand-300/25 bg-brand-500/10 text-brand-800 dark:text-brand-100'}`}>
            <div className="flex items-center gap-2">
              {pdfError || actionError ? <AlertTriangle className="h-4 w-4 shrink-0" /> : <Loader2 className="h-4 w-4 shrink-0 animate-spin" />}
              <span className="font-medium">{pdfError ? `PDF loading error: ${pdfError}` : actionError ? `DocuSign action error: ${actionError}` : 'Loading PDF workspace...'}</span>
            </div>
          </div>
        )}

        <div className="flex-1 grid grid-cols-[280px_1fr_320px] min-h-0">
          {/* LEFT: Recipients + Field palette */}
          <div className="border-r flex flex-col min-h-0 bg-muted/20">
            <div className="p-3 border-b">
              {/* ───── SENDER ───── */}
              <div className="flex items-center justify-between mb-2">
                <Label className="text-xs uppercase tracking-wide flex items-center gap-1">
                  <span className="inline-block w-2 h-2 rounded-sm" style={{ background: SENDER_COLOR }} />
                  Sender
                </Label>
                {!senderRecipient && (
                  <Button size="sm" variant="ghost" onClick={addSender} className="h-7 px-2" title="Add sender">
                    <Plus className="h-3 w-3" />
                  </Button>
                )}
              </div>
              {!senderRecipient && (
                <p className="text-[10px] text-muted-foreground mb-2">
                  Add the sender (you) to place signature/initial/date fields the sender will sign.
                </p>
              )}
              {senderRecipient && (
                <div
                  onClick={() => setActiveRecipientId(senderRecipient.id)}
                  className={`p-2 rounded border cursor-pointer space-y-1 mb-3 ${activeRecipientId === senderRecipient.id ? 'border-primary bg-background' : 'border-border bg-background/50'}`}
                >
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: SENDER_COLOR }} />
                    <Input
                      placeholder="Sender name"
                      value={senderRecipient.name}
                      onChange={(e) => updateRecipient(senderRecipient.id, { name: e.target.value })}
                      className="h-7 text-xs flex-1"
                      onClick={(e) => e.stopPropagation()}
                    />
                    <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); removeRecipient(senderRecipient.id); }} className="h-7 w-7 p-0">
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                  <Input
                    placeholder="sender@example.com"
                    type="email"
                    value={senderRecipient.email}
                    onChange={(e) => updateRecipient(senderRecipient.id, { email: e.target.value })}
                    className="h-7 text-xs"
                    onClick={(e) => e.stopPropagation()}
                  />
                  <div className="flex items-center gap-1">
                    <Input
                      placeholder="Role (e.g. Agent)"
                      value={senderRecipient.roleLabel || ''}
                      onChange={(e) => updateRecipient(senderRecipient.id, { roleLabel: e.target.value })}
                      className="h-7 text-xs flex-1"
                      onClick={(e) => e.stopPropagation()}
                    />
                    <Input
                      type="number"
                      min={1}
                      value={senderRecipient.routingOrder ?? 1}
                      onChange={(e) => updateRecipient(senderRecipient.id, { routingOrder: Number(e.target.value) || 1 })}
                      className="h-7 text-xs w-14"
                      title="Routing order (1 = parallel)"
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>
                </div>
              )}

              <Separator className="my-2" />

              {/* ───── RECIPIENTS ───── */}
              <div className="flex items-center justify-between mb-2">
                <Label className="text-xs uppercase tracking-wide flex items-center gap-1">
                  <Users className="h-3 w-3" /> Recipients
                </Label>
                <Button size="sm" variant="ghost" onClick={addRecipient} className="h-7 px-2">
                  <Plus className="h-3 w-3" />
                </Button>
              </div>
              <ScrollArea className="max-h-[220px]">
                <div className="space-y-2">
                  {externalRecipients.length === 0 && (
                    <p className="text-xs text-muted-foreground">No recipients yet. Add one to begin.</p>
                  )}
                  {externalRecipients.map((r, idx) => (
                    <div
                      key={r.id}
                      onClick={() => setActiveRecipientId(r.id)}
                      className={`p-2 rounded border cursor-pointer space-y-1 ${activeRecipientId === r.id ? 'border-primary bg-background' : 'border-border bg-background/50'}`}
                    >
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: RECIPIENT_COLORS[idx % RECIPIENT_COLORS.length] }} />
                        <Input
                          placeholder="Name"
                          value={r.name}
                          onChange={(e) => updateRecipient(r.id, { name: e.target.value })}
                          className="h-7 text-xs flex-1"
                          onClick={(e) => e.stopPropagation()}
                        />
                        <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); removeRecipient(r.id); }} className="h-7 w-7 p-0">
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                      <Input
                        placeholder="email@example.com"
                        type="email"
                        value={r.email}
                        onChange={(e) => updateRecipient(r.id, { email: e.target.value })}
                        className="h-7 text-xs"
                        onClick={(e) => e.stopPropagation()}
                      />
                      <div className="flex items-center gap-1">
                        <Input
                          placeholder="Role (e.g. Buyer)"
                          value={r.roleLabel || ''}
                          onChange={(e) => updateRecipient(r.id, { roleLabel: e.target.value })}
                          className="h-7 text-xs flex-1"
                          onClick={(e) => e.stopPropagation()}
                        />
                        <Input
                          type="number"
                          min={1}
                          value={r.routingOrder ?? 1}
                          onChange={(e) => updateRecipient(r.id, { routingOrder: Number(e.target.value) || 1 })}
                          className="h-7 text-xs w-14"
                          title="Routing order (1 = parallel)"
                          onClick={(e) => e.stopPropagation()}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>

            <div className="flex-1 min-h-0 flex flex-col">
              <div className="p-3 border-b">
                <Label className="text-xs uppercase tracking-wide">Field Palette</Label>
                <p className="text-[10px] text-muted-foreground mt-1">
                  Pick a recipient, click a field, then click on the PDF to place it.
                </p>
              </div>
              <ScrollArea className="flex-1">
                <div className="p-3 space-y-3">
                  {groups.map(grp => (
                    <div key={grp}>
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{grp}</div>
                      <div className="grid grid-cols-2 gap-1">
                        {FIELD_CATALOG.filter(f => f.group === grp).map(f => (
                          <Button
                            key={f.type}
                            size="sm"
                            variant={activeFieldType === f.type ? 'default' : 'outline'}
                            disabled={!activeRecipientId}
                            onClick={() => setActiveFieldType(activeFieldType === f.type ? null : f.type)}
                            className="h-8 text-[11px] justify-start px-2"
                          >
                            {f.label}
                          </Button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          </div>

          {/* CENTER: PDF viewer with tag overlays */}
          <div className="overflow-auto bg-muted/30" ref={containerRef}>
            {loadingPdf && (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            )}
            {!loadingPdf && (
              <div className="p-4 space-y-4">
                {pages.map((dim, pageIdx) => {
                  // Display canvas at its rendered CSS size; overlays are absolutely positioned in CSS px
                  // We need to know the rendered CSS px → PDF point ratio. After render, canvas.width = pdfPoints * scale.
                  // CSS pixel width = canvas.width (since we don't set CSS width). So:
                  // cssToPoint = dim.width / canvas.width = 1/scale  (canvas.width = dim.width * scale)
                  return (
                    <div key={pageIdx} className="mx-auto" style={{ width: 'fit-content' }}>
                      <div className="text-[10px] text-muted-foreground mb-1 text-center">Page {pageIdx + 1}</div>
                      <div
                        className="relative shadow-lg bg-background"
                        style={{ cursor: activeFieldType ? 'crosshair' : 'default' }}
                        onClick={(e) => handlePageClick(pageIdx, e)}
                      >
                        <canvas id={`pfsm-page-${pageIdx + 1}`} className="block" />
                        {/* Overlays — tabs for this page */}
                        {tabs.filter(t => t.page === pageIdx + 1).map(t => {
                          const renderScale = dim.renderScale || 1.5;
                          // PDF points × renderScale = canvas (CSS) pixels
                          const left = t.x * renderScale;
                          const top = t.y * renderScale;
                          const w = (t.width || 80) * renderScale;
                          const h = (t.height || 20) * renderScale;
                          const color = colorFor(t.recipientId);
                          const isSel = t.id === selectedTabId;
                          const fieldLabel = FIELD_CATALOG.find(f => f.type === t.type)?.label || t.type;
                          return (
                            <div
                              key={t.id}
                              data-signing-tab={t.id}
                              onClick={(e) => { e.stopPropagation(); setSelectedTabId(t.id); }}
                              onPointerDown={(e) => {
                                const pageEl = (e.currentTarget.parentElement as HTMLElement);
                                beginTabDrag(e, t, pageEl, dim);
                              }}
                              className="absolute flex items-center justify-center text-[9px] font-medium border-2 rounded-sm overflow-hidden select-none touch-none"
                              style={{
                                left, top, width: w, height: h,
                                borderColor: color,
                                background: `${color.replace(')', ' / 0.18)').replace('hsl', 'hsla')}`,
                                color,
                                outline: isSel ? '2px solid hsl(var(--primary))' : 'none',
                                outlineOffset: '1px',
                                cursor: 'move',
                              }}
                              title={`${fieldLabel} — ${recipients.find(r => r.id === t.recipientId)?.name || 'Unknown'}`}
                            >
                              {fieldLabel}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* RIGHT: Inspector */}
          <div className="border-l bg-muted/20 flex flex-col min-h-0">
            <div className="p-3 border-b">
              <Label className="text-xs uppercase tracking-wide">Inspector</Label>
            </div>
            <ScrollArea className="flex-1">
              <div className="p-3 space-y-3">
                {!selectedTab && (
                  <p className="text-xs text-muted-foreground">
                    Select a placed field to edit its properties.
                  </p>
                )}
                {selectedTab && (
                  <>
                    <div className="flex items-center justify-between">
                      <Badge style={{ background: colorFor(selectedTab.recipientId), color: 'white' }}>
                        {FIELD_CATALOG.find(f => f.type === selectedTab.type)?.label}
                      </Badge>
                      <Button size="sm" variant="ghost" onClick={() => deleteTab(selectedTab.id)} className="h-7 px-2 text-destructive">
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs">Recipient</Label>
                      <Select value={selectedTab.recipientId} onValueChange={(v) => updateTab(selectedTab.id, { recipientId: v })}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {recipients.map(r => (
                            <SelectItem key={r.id} value={r.id}>{r.name || '(unnamed)'} {r.roleLabel ? `— ${r.roleLabel}` : ''}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs">Label (tooltip)</Label>
                      <Input value={selectedTab.label || ''} onChange={(e) => updateTab(selectedTab.id, { label: e.target.value })} className="h-8 text-xs" />
                    </div>

                    {['text', 'number', 'note'].includes(selectedTab.type) && (
                      <div className="space-y-1">
                        <Label className="text-xs">Default value</Label>
                        <Input value={selectedTab.defaultValue || ''} onChange={(e) => updateTab(selectedTab.id, { defaultValue: e.target.value })} className="h-8 text-xs" />
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs">Width (pt)</Label>
                        <Input type="number" value={Math.round(selectedTab.width ?? 0)} onChange={(e) => updateTab(selectedTab.id, { width: Number(e.target.value) })} className="h-8 text-xs" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Height (pt)</Label>
                        <Input type="number" value={Math.round(selectedTab.height ?? 0)} onChange={(e) => updateTab(selectedTab.id, { height: Number(e.target.value) })} className="h-8 text-xs" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">X (pt)</Label>
                        <Input type="number" value={Math.round(selectedTab.x)} onChange={(e) => updateTab(selectedTab.id, { x: Number(e.target.value) })} className="h-8 text-xs" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Y (pt)</Label>
                        <Input type="number" value={Math.round(selectedTab.y)} onChange={(e) => updateTab(selectedTab.id, { y: Number(e.target.value) })} className="h-8 text-xs" />
                      </div>
                    </div>

                    <div className="flex items-center justify-between">
                      <Label className="text-xs">Required</Label>
                      <Switch checked={!!selectedTab.required} onCheckedChange={(v) => updateTab(selectedTab.id, { required: v })} />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label className="text-xs">Locked (read-only)</Label>
                      <Switch checked={!!selectedTab.locked} onCheckedChange={(v) => updateTab(selectedTab.id, { locked: v })} />
                    </div>
                  </>
                )}

                <Separator />
                <div className="text-[10px] text-muted-foreground space-y-1">
                  <div>Placed fields: <strong>{tabs.length}</strong></div>
                  <div>Recipients: <strong>{recipients.length}</strong></div>
                  <div>Pages: <strong>{pages.length}</strong></div>
                </div>
              </div>
            </ScrollArea>
          </div>
        </div>

        <div className="border-t px-4 py-3 flex items-center justify-between gap-2 bg-background">
          <div className="text-xs text-muted-foreground flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full" style={{ background: activeColor }} />
            Tagging for: <strong>{recipients.find(r => r.id === activeRecipientId)?.name || '(no recipient)'}</strong>
            {activeFieldType && <span>· Field: <strong>{FIELD_CATALOG.find(f => f.type === activeFieldType)?.label}</strong></span>}
          </div>
          <div className="flex gap-2 items-center">
            <Button
              variant="ghost"
              size="sm"
              onClick={undo}
              disabled={undoStackRef.current.length === 0 || !!busy}
              title="Undo (Ctrl/Cmd+Z)"
              data-history-version={historyVersion}
            >
              <Undo2 className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={redo}
              disabled={redoStackRef.current.length === 0 || !!busy}
              title="Redo (Ctrl/Cmd+Shift+Z)"
              data-history-version={historyVersion}
            >
              <Redo2 className="h-4 w-4" />
            </Button>
            <Separator orientation="vertical" className="h-6 mx-1" />
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={!!busy}>Cancel</Button>
            <Button variant="secondary" onClick={() => callFn('save_signing_layout')} disabled={!!busy}>
              {busy === 'save' ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
              Save Layout
            </Button>
            <Button onClick={() => callFn('send_freeform')} disabled={!!busy || recipients.length === 0 || tabs.length === 0}>
              {busy === 'send' ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
              Send for Signature
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
