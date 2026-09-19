import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FileSignature, Send, Loader2, User, MapPin, Phone, Mail, Calendar, UserPlus, CheckCircle2, DollarSign, Layout, Hourglass, AlertTriangle } from 'lucide-react';
import { useAgreementMutations } from '@/hooks/useAgencyAgreements';
import { logActivityDirect } from '@/hooks/useActivityLogger';
import { format } from 'date-fns';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuthenticatedSupabase } from '@/hooks/useAuthenticatedSupabase';
import { useGlobalReportSettings } from '@/hooks/useGlobalReportSettings';
import { toast } from 'sonner';

interface GammaTemplate {
  id: string;
  name: string;
  gamma_template_id: string;
  is_default: boolean;
  is_active: boolean;
}

interface SendAgreementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  client: {
    id: string;
    primary_first_name: string;
    primary_surname: string;
    primary_email: string | null;
    primary_mobile: string | null;
    current_address?: string | null;
    secondary_first_name?: string | null;
    secondary_surname?: string | null;
    secondary_email?: string | null;
    secondary_mobile?: string | null;
  };
  dealId?: string;
}

export function SendAgreementDialog({ open, onOpenChange, client, dealId }: SendAgreementDialogProps) {
  const { generateAgreement, sendViaDocuSign } = useAgreementMutations();
  const { settings: brandSettings } = useGlobalReportSettings();
  const agencyLegalName = brandSettings.contactDetails.company_name || 'the Agency';
  // Staff-JWT client so gamma_agreement_templates can drop its anon grants (RLS-W2).
  const { supabase: authedSupabase } = useAuthenticatedSupabase();

  // Fetch available Gamma templates
  const { data: templates = [] } = useQuery({
    queryKey: ['gamma-templates-active'],
    queryFn: async () => {
      const { data, error } = await authedSupabase
        .from('gamma_agreement_templates' as any)
        .select('id, name, gamma_template_id, is_default, is_active')
        .eq('is_active', true)
        .order('is_default', { ascending: false })
        .order('name');
      if (error) throw error;
      return (data || []) as unknown as GammaTemplate[];
    },
    enabled: open,
  });

  // Pre-fill from client data
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [buyerNames, setBuyerNames] = useState('');
  const [buyerAddress, setBuyerAddress] = useState('');
  const [buyerPhone, setBuyerPhone] = useState('');
  const [buyerEmail, setBuyerEmail] = useState('');
  const [agreementDate, setAgreementDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [secondaryBuyerName, setSecondaryBuyerName] = useState('');
  const [secondaryBuyerEmail, setSecondaryBuyerEmail] = useState('');
  const hasSecondaryContact = !!(client.secondary_first_name || client.secondary_surname);
  const [commitmentFee, setCommitmentFee] = useState('$1,500.00 + GST');
  const [notes, setNotes] = useState('');
  const [step, setStep] = useState<'fill' | 'confirm' | 'sent'>('fill');
  const [generatedId, setGeneratedId] = useState<string | null>(null);
  const [pdfReady, setPdfReady] = useState(false);
  const [pdfPolling, setPdfPolling] = useState(false);
  const [pdfPollAttempts, setPdfPollAttempts] = useState(0);
  const [pdfTimedOut, setPdfTimedOut] = useState(false);

  /**
   * The dialog is seeded ONCE per opening, and never re-seeded because the
   * parent re-rendered.
   *
   * This effect used to depend on `[open, client]`, and the client modal
   * builds `client={{ ... }}` as an object literal at the call site — a fresh
   * identity on every one of its renders. So a background refetch, or the
   * token estimate ticking over, re-ran the whole block while the dialog was
   * open: every field was reset to the client's stored value and `notes` was
   * cleared outright. On a client whose phone and email are blank in the
   * record, that meant the two fields the operator had just filled in emptied
   * themselves a few seconds later, which is exactly how it was reported.
   *
   * `client.id` is the identity that matters, and it is a PRIMITIVE: the
   * effect re-runs when the dialog opens, and when it is open and genuinely
   * switches to another client — never because the parent re-rendered.
   */
  useEffect(() => {
    if (!open) return;

    setBuyerNames(`${client.primary_first_name} ${client.primary_surname}`);
    setBuyerAddress(client.current_address || '');
    setBuyerPhone(client.primary_mobile || '');
    setBuyerEmail(client.primary_email || '');
    setAgreementDate(format(new Date(), 'yyyy-MM-dd'));
    setSecondaryBuyerName(
      client.secondary_first_name && client.secondary_surname
        ? `${client.secondary_first_name} ${client.secondary_surname}`
        : ''
    );
    setSecondaryBuyerEmail(client.secondary_email || '');
    setCommitmentFee('$1,500.00 + GST');
    setNotes('');
    setStep('fill');
    setGeneratedId(null);
    setPdfReady(false);
    setPdfPolling(false);
    setPdfPollAttempts(0);
    setPdfTimedOut(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the
    // client's IDENTITY, deliberately. `client` itself is a fresh object on
    // every render of the parent, and naming it here is the defect above.
  }, [open, client.id]);

  /**
   * Detail that arrives after the dialog opened may fill a blank. It may
   * never overwrite something the operator typed.
   *
   * The client modal loads the full record separately, so `current_address`
   * and the secondary buyer are often undefined at the moment the dialog
   * opens and arrive a moment later. Seeding once would lose them; seeding
   * again unconditionally is the defect above. The functional updater keeps
   * a non-empty field exactly as it is, and every dependency here is a
   * PRIMITIVE, so this runs when a value actually changes rather than on
   * every render of the parent.
   */
  useEffect(() => {
    if (!open) return;
    setBuyerAddress((current) => current || client.current_address || '');
    setSecondaryBuyerName((current) =>
      current ||
      (client.secondary_first_name && client.secondary_surname
        ? `${client.secondary_first_name} ${client.secondary_surname}`
        : ''),
    );
    setSecondaryBuyerEmail((current) => current || client.secondary_email || '');
  }, [
    open,
    client.current_address,
    client.secondary_first_name,
    client.secondary_surname,
    client.secondary_email,
  ]);

  // Poll PDF readiness once we have a generated agreement (Gamma generation is async)
  useEffect(() => {
    if (step !== 'confirm' || !generatedId || pdfReady) return;
    let cancelled = false;
    setPdfPolling(true);
    setPdfTimedOut(false);

    const MAX_ATTEMPTS = 40; // ~2 min @ 3s
    let attempt = 0;

    const tick = async () => {
      if (cancelled) return;
      attempt += 1;
      setPdfPollAttempts(attempt);
      try {
        const { data, error } = await supabase
          .from('agency_agreements')
          .select('pdf_storage_path, status')
          .eq('id', generatedId)
          .maybeSingle();
        if (!cancelled && !error && data?.pdf_storage_path) {
          setPdfReady(true);
          setPdfPolling(false);
          return;
        }
      } catch { /* ignore */ }
      if (attempt >= MAX_ATTEMPTS) {
        if (!cancelled) {
          setPdfTimedOut(true);
          setPdfPolling(false);
        }
        return;
      }
      setTimeout(tick, 3000);
    };
    tick();
    return () => { cancelled = true; };
  }, [step, generatedId, pdfReady]);

  // Auto-select default template when templates load
  useEffect(() => {
    if (templates.length > 0 && !selectedTemplateId) {
      const defaultTemplate = templates.find(t => t.is_default);
      setSelectedTemplateId(defaultTemplate?.id || templates[0].id);
    }
  }, [templates, selectedTemplateId]);

  const handleGenerate = async () => {
    try {
      const result = await generateAgreement.mutateAsync({
        clientId: client.id,
        buyerNames,
        buyerAddress,
        buyerPhone,
        buyerEmail,
        agreementDate,
        secondaryBuyerName: secondaryBuyerName || undefined,
        secondaryBuyerEmail: secondaryBuyerEmail || undefined,
        dealId,
        notes: notes || undefined,
        initialCommitmentFee: commitmentFee || undefined,
        templateId: selectedTemplateId || undefined,
      });

      setGeneratedId(result?.agreement_id);
      setStep('confirm');

      logActivityDirect({
        actionType: 'agreement_generated',
        entityType: 'agency_agreement',
        entityId: result?.agreement_id,
        entityName: buyerNames,
        metadata: { client_id: client.id },
      });
    } catch {
      // Error handled by mutation
    }
  };

  const handleSendDocuSign = async () => {
    if (!generatedId) return;
    if (!pdfReady) {
      toast.warning('The agreement document is still being generated. Please wait a few seconds before sending.');
      return;
    }
    try {
      await sendViaDocuSign.mutateAsync(generatedId);
      setStep('sent');

      logActivityDirect({
        actionType: 'agreement_sent',
        entityType: 'agency_agreement',
        entityId: generatedId,
        entityName: buyerNames,
        metadata: { client_id: client.id, method: 'docusign' },
      });
    } catch {
      // Error handled by mutation
    }
  };

  const isGenerating = generateAgreement.isPending;
  const isSending = sendViaDocuSign.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* sm:overflow-y-auto is load-bearing: the dialog base sets
          sm:overflow-visible, which silently wins over the unprefixed
          overflow-y-auto at ≥640px and let the form spill past the frame. */}
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto sm:max-w-2xl sm:max-h-[85dvh] sm:overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSignature className="h-5 w-5 text-primary" />
            Send Agency Agreement
          </DialogTitle>
          <DialogDescription>
            Pre-fill the Buyer's Agent Agreement and send via DocuSign for e-signature.
          </DialogDescription>
        </DialogHeader>

        {step === 'fill' && (
          <div className="space-y-4 py-2">
            {/* Template Selection */}
            {templates.length > 0 && (
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5">
                  <Layout className="h-3.5 w-3.5 text-muted-foreground" />
                  Agreement Template
                </Label>
                <Select value={selectedTemplateId} onValueChange={setSelectedTemplateId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a template..." />
                  </SelectTrigger>
                  <SelectContent>
                    {templates.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name} {t.is_default ? '(Default)' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Agreement Date */}
            <div className="space-y-1.5">
              <Label htmlFor="agreement-date" className="flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                Agreement Date
              </Label>
              <Input
                id="agreement-date"
                type="date"
                value={agreementDate}
                onChange={(e) => setAgreementDate(e.target.value)}
              />
            </div>

            <Separator />

            {/* Buyer Details Section */}
            <div>
              <h4 className="text-sm font-semibold text-foreground mb-3">Buyer Details</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="buyer-names" className="flex items-center gap-1.5">
                    <User className="h-3.5 w-3.5 text-muted-foreground" />
                    Buyer's Name(s) *
                  </Label>
                  <Input
                    id="buyer-names"
                    value={buyerNames}
                    onChange={(e) => setBuyerNames(e.target.value)}
                    placeholder="Full legal name(s)"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="buyer-email" className="flex items-center gap-1.5">
                    <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                    Email *
                  </Label>
                  <Input
                    id="buyer-email"
                    type="email"
                    value={buyerEmail}
                    onChange={(e) => setBuyerEmail(e.target.value)}
                    placeholder="buyer@email.com"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="buyer-address" className="flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                    Address
                  </Label>
                  <Input
                    id="buyer-address"
                    value={buyerAddress}
                    onChange={(e) => setBuyerAddress(e.target.value)}
                    placeholder="Full address"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="buyer-phone" className="flex items-center gap-1.5">
                    <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                    Phone Number
                  </Label>
                  <Input
                    id="buyer-phone"
                    value={buyerPhone}
                    onChange={(e) => setBuyerPhone(e.target.value)}
                    placeholder="04XX XXX XXX"
                  />
                </div>
              </div>
            </div>

            {/* Secondary Buyer — only when client profile has a secondary contact */}
            {hasSecondaryContact && (
              <div>
                <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-1.5">
                  <UserPlus className="h-3.5 w-3.5 text-muted-foreground" />
                  Secondary Buyer
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="secondary-buyer">Name</Label>
                    <Input
                      id="secondary-buyer"
                      value={secondaryBuyerName}
                      onChange={(e) => setSecondaryBuyerName(e.target.value)}
                      placeholder="Joint applicant name"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="secondary-buyer-email">Email (for DocuSign)</Label>
                    <Input
                      id="secondary-buyer-email"
                      type="email"
                      value={secondaryBuyerEmail}
                      onChange={(e) => setSecondaryBuyerEmail(e.target.value)}
                      placeholder="Leave blank to reuse primary email"
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-1.5">
                  If left blank, the secondary signer will receive the envelope at the primary buyer's email.
                </p>
              </div>
            )}

            {/* Initial Commitment Fee */}
            <div className="space-y-1.5">
              <Label htmlFor="commitment-fee" className="flex items-center gap-1.5">
                <DollarSign className="h-3.5 w-3.5 text-muted-foreground" />
                Initial Commitment Fee
              </Label>
              <Input
                id="commitment-fee"
                value={commitmentFee}
                onChange={(e) => setCommitmentFee(e.target.value)}
                placeholder="$1,500.00 + GST"
              />
            </div>

            <Separator />

            {/* Notes */}
            <div className="space-y-1.5">
              <Label htmlFor="notes">Internal Notes (optional)</Label>
              <Textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Any internal notes about this agreement..."
                rows={2}
              />
            </div>

            {/* Preview Card */}
            <Card className="bg-muted/50 border-dashed">
              <CardContent className="pt-4 text-sm space-y-1">
                <p className="font-medium text-foreground">Agreement Preview</p>
                <p className="text-muted-foreground">
                  This agreement will be generated between <strong>{buyerNames || '...'}</strong> and{' '}
                  <strong>{agencyLegalName}</strong>, dated{' '}
                  <strong>{agreementDate ? format(new Date(agreementDate), 'dd MMMM yyyy') : '...'}</strong>.
                </p>
                {secondaryBuyerName && (
                  <p className="text-muted-foreground">
                    Secondary buyer: <strong>{secondaryBuyerName}</strong>
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {step === 'confirm' && (
          <div className="space-y-4 py-2">
            <Card className="border-primary/30 bg-primary/5">
              <CardContent className="pt-4 space-y-3">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-primary" />
                  <p className="font-medium">Agreement Generated Successfully</p>
                </div>
                <p className="text-sm text-muted-foreground">
                  The Buyer's Agent Agreement has been pre-filled with the provided details and stored as a PDF.
                </p>
                <Separator />
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="text-muted-foreground">Buyer:</span>
                    <p className="font-medium">{buyerNames}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Email:</span>
                    <p className="font-medium">{buyerEmail}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Date:</span>
                    <p className="font-medium">{format(new Date(agreementDate), 'dd MMM yyyy')}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Method:</span>
                    <Badge variant="outline" className="mt-0.5">DocuSign</Badge>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* PDF readiness indicator — Gamma generation is async */}
            {!pdfReady && pdfPolling && (
              <Card className="border-warning/40 bg-warning/5">
                <CardContent className="pt-4 flex items-start gap-3">
                  <Hourglass className="h-5 w-5 text-warning animate-pulse mt-0.5 shrink-0" />
                  <div className="space-y-1 text-sm">
                    <p className="font-medium text-foreground">
                      Generating the agreement document…
                    </p>
                    <p className="text-muted-foreground">
                      The Gamma template is still being rendered into a PDF. The DocuSign envelope
                      will be unlocked as soon as the document is ready (usually 30–90 seconds).
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Checking… attempt {pdfPollAttempts}/40
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}

            {!pdfReady && pdfTimedOut && (
              <Card className="border-destructive/40 bg-destructive/5">
                <CardContent className="pt-4 flex items-start gap-3">
                  <AlertTriangle className="h-5 w-5 text-destructive mt-0.5 shrink-0" />
                  <div className="space-y-2 text-sm">
                    <p className="font-medium text-foreground">
                      Document still not ready after 2 minutes
                    </p>
                    <p className="text-muted-foreground">
                      Gamma is taking longer than expected. You can retry the readiness check, or
                      send anyway and the edge function will attempt one more deferred fetch before
                      dispatching the envelope.
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setPdfTimedOut(false);
                        setPdfPollAttempts(0);
                        setPdfReady(false);
                      }}
                    >
                      Retry check
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {pdfReady && (
              <Card className="border-success/40 bg-success/5">
                <CardContent className="pt-4 flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-success" />
                  <p className="text-sm font-medium">Document ready — safe to send.</p>
                </CardContent>
              </Card>
            )}

            <p className="text-sm text-muted-foreground">
              Click <strong>"Send via DocuSign"</strong> to dispatch this agreement to <strong>{buyerEmail}</strong> for electronic signature.
            </p>
          </div>
        )}

        {step === 'sent' && (
          <div className="py-8 text-center space-y-4">
            <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
              <Send className="h-7 w-7 text-primary" />
            </div>
            <div>
              <h3 className="text-lg font-semibold">Agreement Sent!</h3>
              <p className="text-sm text-muted-foreground mt-1">
                The agreement has been dispatched to <strong>{buyerEmail}</strong> via DocuSign.
                You'll be notified when the client views or signs the document.
              </p>
            </div>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </div>
        )}

        {step !== 'sent' && (
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            {step === 'fill' && (
              <Button
                onClick={handleGenerate}
                disabled={!buyerNames || !buyerEmail || isGenerating}
              >
                {isGenerating ? (
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                ) : (
                  <FileSignature className="h-4 w-4 mr-1.5" />
                )}
                Generate Agreement
              </Button>
            )}
            {step === 'confirm' && (
              <Button
                onClick={handleSendDocuSign}
                disabled={isSending || (!pdfReady && !pdfTimedOut)}
                title={!pdfReady ? 'Waiting for the agreement document to finish generating…' : undefined}
              >
                {isSending ? (
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                ) : !pdfReady && pdfPolling ? (
                  <Hourglass className="h-4 w-4 mr-1.5 animate-pulse" />
                ) : (
                  <Send className="h-4 w-4 mr-1.5" />
                )}
                {!pdfReady && pdfPolling ? 'Waiting for document…' : 'Send via DocuSign'}
              </Button>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
