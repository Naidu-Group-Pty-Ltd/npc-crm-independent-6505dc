/**
 * Creating a client from inside an assessment — after checking they are not
 * already in the book.
 *
 * ## One form, two places
 *
 * The final step (Save & link) had this form inline; the intake step's "Create
 * a new client" opened the whole client list in a new browser tab, where the
 * client was created with no assessment context at all — nothing recorded that
 * the client came from this assessment, the new record's own Commercial /
 * Industrial tab said "No assessments linked", and the adviser had to find the
 * same person again at the end. Both places now use this form, which creates
 * through `manage-ci-assessments` against this assessment, so the link step
 * starts with the client already selected.
 *
 * ## Duplicates are offered, not merely refused
 *
 * As the name and email are typed, the client book is searched for them. A
 * possible match is shown above the Create button — with "Use this client" where
 * the caller can use an existing record — because a duplicate client splits
 * one person's history across two records and is far harder to undo than to
 * prevent. An email already on file comes back from the server as that client,
 * where the adviser may reach them, rather than as an error.
 */

import { useEffect, useState, type ChangeEvent } from 'react';
import { AlertTriangle, Loader2, User, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/hooks/use-toast';
import type { ClientSearchRow } from '@/hooks/useCiAssessments';
import { createClient, searchClients } from '@/lib/ciAssessment/assessmentManagement';
import { clientLabel, newClientProblem } from '@/lib/ciAssessment/clientRecords';

interface Props {
  assessmentId: string;
  /** Prefill, usually from the assessment's borrowing entity. */
  initial: { firstName: string; surname: string };
  onCreated: (client: ClientSearchRow) => void;
  onCancel?: () => void;
  /**
   * Offered beside a possible match or a duplicate email. Omitted where an
   * existing client cannot be used from here — the match is then shown as a
   * warning, with where they can be linked instead.
   */
  onUseExisting?: (client: ClientSearchRow) => void;
  /** The heading and first line, which differ between the two places. */
  heading?: string;
  intro?: string;
  disabled?: boolean;
}

export function ClientCreateForm({
  assessmentId, initial, onCreated, onCancel, onUseExisting, heading, intro, disabled,
}: Props) {
  const [draft, setDraft] = useState({ firstName: initial.firstName, surname: initial.surname, email: '', mobile: '' });
  const [creating, setCreating] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [existing, setExisting] = useState<ClientSearchRow | null>(null);
  const [found, setFound] = useState<ClientSearchRow[]>([]);

  // Possible matches, from what has been typed so far — an email once it looks
  // like one, otherwise the name once there is a surname to search on.
  const name = `${draft.firstName} ${draft.surname}`.trim();
  const email = draft.email.trim();
  const term = email.includes('@') ? email : draft.surname.trim().length >= 2 ? name : '';
  const searchable = term.length >= 2;
  useEffect(() => {
    if (!searchable) return undefined;
    let cancelled = false;
    const timer = setTimeout(() => {
      void searchClients(term).then((result) => {
        if (!cancelled) setFound((result.data ?? []).slice(0, 4));
      });
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [term, searchable]);
  // The last answer stands while the next is on its way, as it did when this
  // was set directly; with nothing searchable there are no matches at all.
  const matches = searchable ? found : [];

  const create = async () => {
    const invalid = newClientProblem({ firstName: draft.firstName, surname: draft.surname, email: draft.email });
    if (invalid) { setProblem(invalid.message); return; }
    setProblem(null);
    setExisting(null);
    setCreating(true);
    const result = await createClient({
      firstName: draft.firstName.trim(),
      surname: draft.surname.trim(),
      email: email || undefined,
      mobile: draft.mobile.trim() || undefined,
      assessmentId,
    });
    setCreating(false);
    if (result.existingClient) {
      setExisting(result.existingClient);
      setProblem(result.error);
      return;
    }
    if (result.error || !result.data) {
      setProblem(result.error ?? 'The client could not be created. Try again.');
      return;
    }
    toast({ title: 'Client created', description: `${clientLabel(result.data)} was added to your client book.` });
    onCreated(result.data);
  };

  const set = (key: keyof typeof draft) => (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setDraft((current) => ({ ...current, [key]: value }));
    // A duplicate email is a statement about THAT address; a new one is a new question.
    if (key === 'email') { setExisting(null); setProblem(null); }
  };

  const suggestions = existing ? [existing, ...matches.filter((match) => match.id !== existing.id)] : matches;

  return (
    <div className="rounded-lg border border-border bg-muted/25 p-4">
      <h3 className="text-sm font-semibold tracking-tight text-foreground">{heading ?? 'Create a new client'}</h3>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {intro ?? 'Prefilled from this assessment where possible — check it before creating.'}
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`new-client-first-${assessmentId}`} className="ci-field-label">First name</Label>
          <Input id={`new-client-first-${assessmentId}`} className="mt-1.5" value={draft.firstName} onChange={set('firstName')} autoComplete="off" disabled={disabled} />
        </div>
        <div>
          <Label htmlFor={`new-client-surname-${assessmentId}`} className="ci-field-label">Surname</Label>
          <Input id={`new-client-surname-${assessmentId}`} className="mt-1.5" value={draft.surname} onChange={set('surname')} autoComplete="off" disabled={disabled} />
        </div>
        <div>
          <Label htmlFor={`new-client-email-${assessmentId}`} className="ci-field-label">Email</Label>
          <Input id={`new-client-email-${assessmentId}`} className="mt-1.5" type="email" value={draft.email} onChange={set('email')} autoComplete="off" disabled={disabled} />
        </div>
        <div>
          <Label htmlFor={`new-client-mobile-${assessmentId}`} className="ci-field-label">Mobile</Label>
          <Input id={`new-client-mobile-${assessmentId}`} className="mt-1.5" value={draft.mobile} onChange={set('mobile')} autoComplete="off" disabled={disabled} />
        </div>
      </div>

      {suggestions.length ? (
        <div className="ci-warning-row ci-warning-warning mt-3" role="status">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="font-medium text-foreground">
              {existing ? 'This client is already in your client book' : 'Possibly already in your client book'}
            </p>
            <p className="text-xs text-muted-foreground">
              {onUseExisting
                ? 'Use the existing record rather than creating a second one for the same person.'
                : 'If this is them, you do not need a new record — link them on the final step instead.'}
            </p>
            <ul className="mt-2 space-y-1.5">
              {suggestions.map((match) => (
                <li key={match.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2 text-sm">
                    <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="font-medium text-foreground">{clientLabel(match)}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {[match.primary_email, match.primary_mobile].filter(Boolean).join(' · ') || 'No contact details'}
                    </span>
                  </span>
                  {onUseExisting ? (
                    <Button size="sm" variant="outline" onClick={() => onUseExisting(match)} disabled={disabled || creating}>
                      Use this client
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      {problem && !existing ? (
        <p className="mt-3 text-sm text-destructive" role="alert">{problem}</p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {/* An email already on file will be refused again as it stands, so
            the button waits for a different address rather than inviting
            the same refusal. */}
        <Button size="sm" onClick={() => void create()} disabled={creating || disabled || Boolean(existing)}>
          {creating
            ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            : <UserPlus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
          {creating ? 'Creating…' : suggestions.length ? 'Create a new client anyway' : 'Create client'}
        </Button>
        {onCancel ? (
          <Button size="sm" variant="ghost" onClick={onCancel} disabled={creating}>Cancel</Button>
        ) : null}
      </div>
    </div>
  );
}
