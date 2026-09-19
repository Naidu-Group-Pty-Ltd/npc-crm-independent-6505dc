import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SearchInput } from '@/components/ui/search-input';
import {
  AlertTriangle, Check, ExternalLink, Link2, Loader2, Unlink, User, UserPlus,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ciAssessmentApi, type ClientSearchRow } from '@/hooks/useCiAssessments';
import { fetchClientProfile } from '@/utils/commercial/clientPortfolioRepository';
import {
  buildReconciliationPlan, reconcileAssessmentWithClient,
  type ReconciliationDisposition, type ReconciliationItem, type ReconciliationSummary,
} from '@/lib/ciAssessment/reconciliation';
import type { AssessmentPayload } from '@/lib/ciAssessment/types';
import { clientCommercialIndustrialPath } from '@/lib/ciAssessment/clientRoute';
import { prefillFromAssessment } from './clientPrefill';
import { toast } from '@/hooks/use-toast';

const DISPOSITION_OPTIONS: ReadonlyArray<{ value: ReconciliationDisposition; label: string }> = [
  { value: 'assessment_only', label: 'Keep in assessment only' },
  { value: 'update_client', label: 'Update the client record' },
  { value: 'create_portfolio_item', label: 'Create a new portfolio item' },
  { value: 'update_portfolio_item', label: 'Update the existing portfolio item' },
];

const CATEGORY_TONE: Record<ReconciliationItem['category'], string> = {
  matching: 'ci-status-good',
  new: 'ci-status-progress',
  conflicting: 'ci-status-warn',
  outdated: 'ci-status-warn',
  excluded: 'ci-status-neutral',
};

function clientLabel(client: ClientSearchRow): string {
  return [client.primary_first_name, client.primary_surname].filter(Boolean).join(' ') || 'Unnamed client';
}

function renderValue(value: unknown): string {
  if (value == null) return 'Not present';
  if (typeof value === 'number') return value.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, entry]) => `${key}: ${typeof entry === 'number' ? entry.toLocaleString('en-AU') : String(entry)}`)
      .join(' · ');
  }
  return String(value);
}

interface Props {
  assessmentId: string;
  payload: AssessmentPayload;
  linkedClientId: string | null;
  onLinked: () => void;
  canLink: boolean;
  canUpdateClient: boolean;
}

/**
 * Final step — client association.
 *
 * The sequence is deliberate and enforced: find the client — by search, where
 * the record found must then be confirmed, or by creating one here — then
 * reconcile every field, choose a disposition per item, and link. Nothing is
 * written to the client record except the items explicitly set to update it,
 * and the whole decision set is stored on the link for audit.
 */
export function StepClientLink({
  assessmentId, payload, linkedClientId, onLinked, canLink, canUpdateClient,
}: Props) {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [clients, setClients] = useState<ClientSearchRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<ClientSearchRow | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [reconciliation, setReconciliation] = useState<ReconciliationSummary | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [linking, setLinking] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // ---- The client already linked ----------------------------------------
  /**
   * The client this assessment is already linked to.
   *
   * Only fetched in the linked state, and only to put a name on the panel: a
   * page that says "linked to a client record" without saying which one asks
   * the reader to go and look it up.
   */
  const [linkedClient, setLinkedClient] = useState<ClientSearchRow | null>(null);
  useEffect(() => {
    if (!linkedClientId) { setLinkedClient(null); return; }
    let cancelled = false;
    // Through the module's own workspace read, so the name shown here obeys
    // exactly the client access this function already enforces.
    void ciAssessmentApi.clientWorkspace(linkedClientId).then((result) => {
      const record = result.data?.client;
      // A name is a nicety; the panel and its actions work without one.
      if (cancelled || !record) return;
      setLinkedClient({ ...record, updated_at: null });
    });
    return () => { cancelled = true; };
  }, [linkedClientId]);

  const confirmClient = useCallback(async (client: ClientSearchRow) => {
    setConfirmed(true);
    setLoadingProfile(true);
    try {
      const profile = await fetchClientProfile(client.id);
      setReconciliation(reconcileAssessmentWithClient(payload, profile));
    } catch (error) {
      toast({
        title: 'Could not load the client portfolio',
        description: error instanceof Error ? error.message : 'Try again, or link without reconciling.',
        variant: 'destructive',
      });
      setConfirmed(false);
    } finally {
      setLoadingProfile(false);
    }
  }, [payload]);

  // ---- Create a new client ----------------------------------------------
  const [creatingOpen, setCreatingOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState(() => ({
    ...prefillFromAssessment(payload), email: '', mobile: '',
  }));

  const createAndSelect = useCallback(async () => {
    if (!draft.firstName.trim() && !draft.surname.trim()) {
      toast({ title: 'A name is required', description: 'Enter at least a first name or surname.', variant: 'destructive' });
      return;
    }
    setCreating(true);
    const result = await ciAssessmentApi.createClient({
      firstName: draft.firstName.trim(),
      surname: draft.surname.trim(),
      email: draft.email.trim() || undefined,
      mobile: draft.mobile.trim() || undefined,
      assessmentId,
    });
    setCreating(false);

    if (result.error || !result.data) {
      toast({ title: 'Could not create the client', description: result.error ?? 'Try again.', variant: 'destructive' });
      return;
    }

    toast({
      title: 'Client created',
      description: `${clientLabel(result.data)} was added to your client book. Review the reconciliation below, then link.`,
    });
    // Straight into the existing flow: the new client becomes the selected
    // client, and reconciliation + linking run exactly as they do for one
    // found by search. One path, not two.
    //
    // The identity confirmation is the one step that is skipped, and only
    // here. "Confirm this is the right client" exists to stop an assessment
    // being linked to the wrong *existing* record — a client created from this
    // form, from details the user has just typed, cannot be someone else. What
    // it cost to keep was worse than what it bought: creating a client left
    // the user two unexplained clicks short of a link, and the reported
    // symptom was a client record with a created-here client and no
    // assessment on it. Linking still takes an explicit action and its own
    // confirmation dialog; nothing is written by creating.
    setCreatingOpen(false);
    setSelected(result.data);
    setReconciliation(null);
    await confirmClient(result.data);
  }, [draft, assessmentId, confirmClient]);

  // Debounced so typing a name does not fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 350);
    return () => clearTimeout(timer);
  }, [search]);

  // A search-first list. Showing the whole client book by default put hundreds
  // of unordered records between the user and the one they wanted, so nothing
  // is fetched until at least two characters are typed.
  const query = debouncedSearch.trim();
  const hasQuery = query.length >= 2;

  useEffect(() => {
    if (!hasQuery) { setClients([]); setSearching(false); return; }
    let cancelled = false;
    setSearching(true);
    ciAssessmentApi.searchClients(query).then((result) => {
      if (cancelled) return;
      // Alphabetical, so a short result set reads predictably.
      setClients([...(result.data ?? [])].sort((a, b) =>
        clientLabel(a).localeCompare(clientLabel(b), 'en-AU', { sensitivity: 'base' })));
      setSearching(false);
    });
    return () => { cancelled = true; };
  }, [query, hasQuery]);



  const setDisposition = (itemId: string, disposition: ReconciliationDisposition) => {
    setReconciliation((current) => current && ({
      ...current,
      items: current.items.map((item) => (item.id === itemId ? { ...item, disposition } : item)),
    }));
  };

  const plan = useMemo(
    () => (reconciliation ? buildReconciliationPlan(reconciliation.items) : null),
    [reconciliation],
  );

  const mutatingCount = plan
    ? plan.clientUpdates.length + plan.portfolioCreates.length + plan.portfolioUpdates.length
    : 0;

  const doLink = async () => {
    if (!selected || !reconciliation) return;
    setLinking(true);
    const applied = reconciliation.items
      .filter((item) => item.disposition !== 'assessment_only')
      .map((item) => ({
        id: item.id, field: item.field, section: item.section,
        disposition: item.disposition, value: item.assessmentValue,
        clientRecordId: item.clientRecordId ?? null,
      }));

    const result = await ciAssessmentApi.linkClient({
      assessmentId,
      clientId: selected.id,
      reconciliationItems: reconciliation.items,
      appliedChanges: applied,
    });
    setLinking(false);
    setConfirmOpen(false);

    if (result.error) {
      toast({ title: 'Link failed', description: result.error, variant: 'destructive' });
      return;
    }
    toast({
      title: 'Assessment linked',
      description: mutatingCount
        ? `${mutatingCount} item(s) recorded for the client record.`
        : 'Linked without changing any client data.',
    });
    onLinked();
  };

  const doUnlink = async () => {
    setLinking(true);
    const result = await ciAssessmentApi.unlinkClient(assessmentId);
    setLinking(false);
    if (result.error) {
      toast({ title: 'Unlink failed', description: result.error, variant: 'destructive' });
      return;
    }
    toast({ title: 'Assessment unlinked', description: 'The assessment and its audit history are preserved.' });
    onLinked();
  };

  // ---- Already linked ------------------------------------------------------
  if (linkedClientId) {
    return (
      <div className="ci-step-panel space-y-4">
        <h2 className="ci-step-heading">Client link</h2>
        <div className="ci-warning-row ci-warning-info">
          <Link2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-medium text-foreground">
              {linkedClient
                ? `This assessment is linked to ${clientLabel(linkedClient)}.`
                : 'This assessment is linked to a client record.'}
            </p>
            <p className="mt-0.5 text-sm">
              It appears in their Commercial / Industrial file along with its calculations and reports.
              Unlinking preserves the assessment, its calculation history and its audit trail — it only
              removes the association.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {/* Straight to this client's C&I file — not the client list, which
              is where every "open client" in this module used to land. */}
          <Button onClick={() => navigate(clientCommercialIndustrialPath(linkedClientId))}>
            <ExternalLink className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            Open client
          </Button>
          <Button variant="outline" onClick={doUnlink} disabled={linking || !canLink}>
            <Unlink className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Unlink from client
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="ci-step-panel space-y-5">
      <div>
        <h2 className="ci-step-heading">Save and link</h2>
        <p className="ci-step-description">
          The assessment is complete. From here you can either{' '}
          <span className="font-medium text-foreground">Link it to an existing client</span> or{' '}
          <span className="font-medium text-foreground">Create a New Client</span>.
        </p>
      </div>


      {!canLink ? (
        <div className="ci-warning-row ci-warning-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
          <span>
            You do not have permission to link assessments to client records. The assessment remains
            saved and can be exported without linking.
          </span>
        </div>
      ) : null}

      {/* ---- 1. Search, or create -------------------------------------- */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold tracking-tight text-foreground">1. Find the client</h3>
        {/*
          The two ways of naming a client sit together, at the top.
          "Create a new client" used to be its own section *below* the results
          — which on a book of any size put it under a long scrolling list,
          where the person who could not find their client had already given
          up. Searching and creating answer the same question, so they are
          offered in the same place.
        */}
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[16rem] flex-1 max-w-md">
            <Label htmlFor="client-search" className="ci-field-label">Search your clients</Label>
            <SearchInput
              value={search}
              onValueChange={setSearch}
              id="client-search"
              disabled={!canLink}
              placeholder="Name or email"
              containerClassName="mt-1.5"
            />
          </div>
          {!creatingOpen ? (
            <Button
              variant="outline" disabled={!canLink}
              onClick={() => setCreatingOpen(true)}
            >
              <UserPlus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              Create a new client instead
            </Button>
          ) : null}
        </div>
        <div className="max-w-md">
          <p className="mt-1.5 text-xs text-muted-foreground">
            Start typing a client's name to see matches. Only clients you are authorised to access appear here.
          </p>
        </div>

        {selected && !clients.some((c) => c.id === selected.id) ? (
          <div className="ci-warning-row ci-warning-info max-w-md">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <span>
              Selected: <span className="font-medium text-foreground">{clientLabel(selected)}</span>
            </span>
          </div>
        ) : null}

        {!hasQuery ? (
          <p className="text-sm text-muted-foreground">
            Type at least two characters of the client's name to search.
          </p>
        ) : searching ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Searching…
          </p>
        ) : !clients.length ? (
          <p className="text-sm text-muted-foreground">No clients match “{query}”.</p>
        ) : (

          <ul className="grid gap-2 sm:grid-cols-2" aria-label="Matching clients">
            {clients.map((client) => (
              <li key={client.id}>
                <button
                  type="button"
                  disabled={!canLink}
                  aria-pressed={selected?.id === client.id}
                  className={cn('ci-client-option', selected?.id === client.id && 'ci-client-option-active')}
                  onClick={() => { setSelected(client); setConfirmed(false); setReconciliation(null); }}
                >
                  <span className="flex min-w-0 items-start gap-2.5">
                    <User className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-foreground">{clientLabel(client)}</span>
                      <span className="block truncate text-xs text-muted-foreground">{client.primary_email || 'No email recorded'}</span>
                      <span className="block truncate text-xs text-muted-foreground">{client.primary_mobile || 'No phone recorded'}</span>
                    </span>
                  </span>
                  {selected?.id === client.id ? <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" /> : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ---- 1b. The create form ------------------------------------------ */}
      {creatingOpen ? (
        <section className="space-y-3">
          <div className="rounded-lg border border-border bg-muted/25 p-4">
            <h3 className="text-sm font-semibold tracking-tight text-foreground">Create a new client</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Prefilled from this assessment where possible — check it before creating. The client is
              added to your book and then linked through the same confirmation and reconciliation steps.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="new-client-first" className="ci-field-label">First name</Label>
                <Input
                  id="new-client-first" className="mt-1.5" value={draft.firstName}
                  onChange={(event) => setDraft((d) => ({ ...d, firstName: event.target.value }))}
                  autoComplete="off"
                />
              </div>
              <div>
                <Label htmlFor="new-client-surname" className="ci-field-label">Surname</Label>
                <Input
                  id="new-client-surname" className="mt-1.5" value={draft.surname}
                  onChange={(event) => setDraft((d) => ({ ...d, surname: event.target.value }))}
                  autoComplete="off"
                />
              </div>
              <div>
                <Label htmlFor="new-client-email" className="ci-field-label">Email</Label>
                <Input
                  id="new-client-email" className="mt-1.5" type="email" value={draft.email}
                  onChange={(event) => setDraft((d) => ({ ...d, email: event.target.value }))}
                  autoComplete="off"
                />
              </div>
              <div>
                <Label htmlFor="new-client-mobile" className="ci-field-label">Mobile</Label>
                <Input
                  id="new-client-mobile" className="mt-1.5" value={draft.mobile}
                  onChange={(event) => setDraft((d) => ({ ...d, mobile: event.target.value }))}
                  autoComplete="off"
                />
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={createAndSelect} disabled={creating}>
                {creating
                  ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  : <UserPlus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
                {creating ? 'Creating…' : 'Create client'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setCreatingOpen(false)} disabled={creating}>
                Cancel
              </Button>
            </div>
          </div>
        </section>
      ) : null}

      {/* ---- 2. Confirm --------------------------------------------------- */}
      {selected && !confirmed ? (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold tracking-tight text-foreground">2. Confirm this is the right client</h3>
          <div className="rounded-lg border border-border bg-muted/25 p-4">
            <p className="text-sm font-semibold text-foreground">{clientLabel(selected)}</p>
            <dl className="mt-2 grid gap-1.5 text-sm sm:grid-cols-2">
              <div className="flex gap-2"><dt className="text-muted-foreground">Email</dt><dd className="text-foreground">{selected.primary_email || '—'}</dd></div>
              <div className="flex gap-2"><dt className="text-muted-foreground">Phone</dt><dd className="text-foreground">{selected.primary_mobile || '—'}</dd></div>
            </dl>
            <Button className="mt-3" size="sm" onClick={() => confirmClient(selected)} disabled={loadingProfile}>
              {loadingProfile ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
              Confirm and reconcile
            </Button>
          </div>
        </section>
      ) : null}

      {/* ---- 3. Reconcile ------------------------------------------------- */}
      {reconciliation ? (
        <section className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold tracking-tight text-foreground">3. Reconcile against the client record</h3>
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="outline" className="ci-status-badge ci-status-good">{reconciliation.counts.matching} matching</Badge>
              <Badge variant="outline" className="ci-status-badge ci-status-progress">{reconciliation.counts.new} new</Badge>
              <Badge variant="outline" className="ci-status-badge ci-status-warn">{reconciliation.counts.conflicting} conflicting</Badge>
            </div>
          </div>

          <p className="text-sm text-muted-foreground">
            Choose what happens to each item. Anything left as &ldquo;keep in assessment only&rdquo; leaves the
            client record untouched.
          </p>

          {reconciliation.duplicateWarnings.length ? (
            <div className="ci-warning-row ci-warning-warning">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
              <div>
                <p className="font-medium text-foreground">Possible duplicates</p>
                <ul className="mt-1 space-y-0.5 text-sm">
                  {reconciliation.duplicateWarnings.map((warning) => <li key={warning}>{warning}</li>)}
                </ul>
              </div>
            </div>
          ) : null}

          {!reconciliation.items.length ? (
            <p className="text-sm text-muted-foreground">
              This assessment holds no portfolio, liability or income data to reconcile.
            </p>
          ) : (
            <ul className="space-y-2.5">
              {reconciliation.items.map((item) => (
                <li key={item.id} className="ci-reconcile-item">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground">{item.label}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{item.reason}</p>
                    </div>
                    <span className={cn('ci-status-badge', CATEGORY_TONE[item.category])}>{item.category}</span>
                  </div>

                  <div className="ci-reconcile-compare">
                    <div className="ci-reconcile-side">
                      <p className="ci-reconcile-side-label">In this assessment</p>
                      <p className="ci-reconcile-side-value">{renderValue(item.assessmentValue)}</p>
                    </div>
                    <div className="ci-reconcile-side">
                      <p className="ci-reconcile-side-label">On the client record</p>
                      <p className="ci-reconcile-side-value">{renderValue(item.clientValue)}</p>
                    </div>
                  </div>

                  <div className="mt-2.5 max-w-sm">
                    <Label htmlFor={`disposition-${item.id}`} className="ci-field-label">Action</Label>
                    <Select
                      value={item.disposition}
                      onValueChange={(value) => setDisposition(item.id, value as ReconciliationDisposition)}
                      disabled={!canUpdateClient}
                    >
                      <SelectTrigger id={`disposition-${item.id}`} className="mt-1.5">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {DISPOSITION_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {!canUpdateClient ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        You can link this assessment but not write back to the client record.
                      </p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
            <Button onClick={() => setConfirmOpen(true)} disabled={linking || !canLink}>
              <Link2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Link to {clientLabel(selected!)}
            </Button>
            <p className="text-sm text-muted-foreground">
              {mutatingCount === 0
                ? 'No client data will be changed.'
                : `${mutatingCount} item(s) will be recorded against the client record.`}
            </p>
          </div>
        </section>
      ) : null}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Link this assessment to {selected ? clientLabel(selected) : 'the client'}?</AlertDialogTitle>
            <AlertDialogDescription>
              {mutatingCount === 0
                ? 'The assessment will be associated with this client. No client data will be changed.'
                : `${mutatingCount} reconciliation item(s) will be recorded against the client record. Who linked it, when, and exactly what changed are all written to the audit trail.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={linking}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={doLink} disabled={linking}>
              {linking ? 'Linking…' : 'Confirm link'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
