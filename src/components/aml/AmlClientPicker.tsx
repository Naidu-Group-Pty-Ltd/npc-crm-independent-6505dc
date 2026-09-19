import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { SearchInput } from '@/components/ui/search-input';
import {
  AlertTriangle, Check, FolderOpen, Loader2, Mail, Search, UserPlus, Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  amlCasesApi,
  type AmlActivationClient,
  type AmlClientPickerStatus,
} from "@/lib/aml/amlCasesApi";

/**
 * The client picker for AML/CTF activation.
 *
 * ── What this replaces, and why ───────────────────────────────────────
 * The picker was a bare text box that returned nothing until an operator
 * typed two characters. Every client the platform already held was
 * invisible until somebody guessed a name and spelled it correctly. On this
 * deployment that is 775 clients — 40 active, 735 inactive — and it is why
 * activation felt as though it wanted clients re-entered that the business
 * already had.
 *
 * It now BROWSES the register on open. Search refines rather than reveals.
 *
 * ── The rules it is built on ──────────────────────────────────────────
 * • ONE SOURCE OF TRUTH. Rows come from `search_clients` on `aml-cases`,
 *   the same AML-role-gated op, the same identification-only projection
 *   (never financial data) and the same permission check the dialog already
 *   used. This component holds no client list of its own and creates no
 *   client — activation reads the register, it does not write to it.
 * • A CLIENT WITH AN OPEN CASE IS SHOWN, NOT HIDDEN. Hiding it produces the
 *   worst answer a picker can give — "that client does not exist" — when the
 *   truth is that they are already covered. It is listed, unselectable, and
 *   names the case.
 * • INACTIVE IS SELECTABLE. This form is the sanctioned place an authorised
 *   user confirms a client is real and active; hiding inactive clients would
 *   be a "go and activate them somewhere else first" dead end.
 */

export interface AmlClientPickerProps {
  /** Called when the operator picks a selectable client. */
  onSelect: (client: AmlActivationClient) => void;
  /** Disables the whole control (e.g. while the form is submitting). */
  disabled?: boolean;
  /** Resets and refetches when this changes — the dialog passes `open`. */
  resetKey?: unknown;
  /**
   * Switch to the create-a-new-client form. Omitted when the caller has no
   * creation affordance to offer.
   */
  onCreateNew?: () => void;
}

const PAGE_SIZE = 25;

const STATUS_TABS: Array<{ value: AmlClientPickerStatus; label: string }> = [
  { value: "all", label: "All clients" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

/** Active / Inactive, said the same way everywhere the picker shows a client. */
export function ClientStatusBadge({ active }: { active: boolean }) {
  return active ? (
    <Badge
      variant="outline"
      className="shrink-0 border-success/40 bg-success/10 text-success"
    >
      Active
    </Badge>
  ) : (
    <Badge variant="outline" className="shrink-0 text-muted-foreground">
      Inactive
    </Badge>
  );
}

export function AmlClientPicker({ onSelect, disabled, resetKey, onCreateNew }: AmlClientPickerProps) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [status, setStatus] = useState<AmlClientPickerStatus>("all");

  const [clients, setClients] = useState<AmlActivationClient[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [browsing, setBrowsing] = useState(true);

  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  /**
   * True when the server answered without the browse fields — i.e. it is
   * running a build that predates browsing. Search still works against it;
   * browsing does not, and the picker says so rather than reporting an
   * empty register.
   */
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  /** Guards against a slow earlier response overwriting a newer one. */
  const requestSeq = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  // A change of dialog session clears the box; without this, reopening shows
  // the previous operator's search.
  useEffect(() => {
    setQuery("");
    setDebounced("");
    setStatus("all");
  }, [resetKey]);

  const load = useCallback(
    async (offset: number) => {
      const seq = ++requestSeq.current;
      if (offset === 0) setState("loading");
      else setLoadingMore(true);
      try {
        const page = await amlCasesApi.listClientsForActivation({
          query: debounced,
          status,
          limit: PAGE_SIZE,
          offset,
        });
        if (seq !== requestSeq.current) return;
        const rows = page.clients ?? [];
        /*
         * An answer with no `total`/`browsing` came from a deployment of
         * `aml-cases` that predates browsing. That server returns `[]` to an
         * empty query — and rendering THAT as "No clients yet" is the exact
         * lie this component exists to stop telling: it reads as an empty
         * register and sends an operator off to create a duplicate. It
         * happened for real, on a register of 775 clients, because the
         * function deploy for the browse change was cancelled while the
         * frontend shipped.
         *
         * So the shape of the response decides, not the row count.
         */
        const answered =
          typeof page.total === "number" && typeof page.browsing === "boolean";
        setStale(!answered);
        setClients((prev) => (offset === 0 ? rows : [...prev, ...rows]));
        setTotal(answered ? page.total : rows.length);
        setHasMore(Boolean(page.has_more));
        setBrowsing(answered ? page.browsing : debounced.length < 2);
        setError(null);
        setState("ready");
      } catch (e: any) {
        if (seq !== requestSeq.current) return;
        // A failed lookup is never rendered as "no clients" — that reads as
        // an empty register and sends an operator off to create a duplicate.
        setError(e?.message ?? "The client register could not be reached.");
        setState("error");
      } finally {
        if (seq === requestSeq.current) setLoadingMore(false);
      }
    },
    [debounced, status],
  );

  useEffect(() => { void load(0); }, [load, resetKey]);

  const showing = clients.length;
  const countLabel = useMemo(() => {
    if (total === 0) return null;
    const noun = total === 1 ? "client" : "clients";
    return showing >= total
      ? `${total} ${noun}`
      : `Showing ${showing} of ${total} ${noun}`;
  }, [showing, total]);

  return (
    <div className="space-y-3">
      {/* Search + status slice */}
      <div className="space-y-2.5">
        <SearchInput
          value={query}
          onValueChange={setQuery}
          id="ac-client-search"
          disabled={disabled}
          placeholder="Search by name…"
          autoComplete="off"
          aria-label="Search clients"
        />

        <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          className="flex flex-wrap gap-1.5"
          role="group"
          aria-label="Filter clients by status"
        >
          {STATUS_TABS.map((tab) => {
            const selected = status === tab.value;
            return (
              <Button
                key={tab.value}
                type="button"
                size="sm"
                variant={selected ? "secondary" : "ghost"}
                disabled={disabled}
                aria-pressed={selected}
                className={cn(
                  "h-7 rounded-full px-3 text-xs font-medium",
                  !selected && "text-muted-foreground",
                )}
                onClick={() => setStatus(tab.value)}
              >
                {tab.label}
              </Button>
            );
          })}
        </div>
        {/*
          The way out of the register, for a client the business has never
          held. Kept beside the filters rather than inside the list: it is a
          different KIND of action from picking somebody, and burying it in
          an empty state would hide it exactly when the register is full.
        */}
        {onCreateNew && (
          <Button
            type="button" size="sm" variant="outline"
            className="h-7 gap-1.5 px-2.5 text-xs"
            disabled={disabled}
            onClick={onCreateNew}
          >
            <UserPlus aria-hidden="true" className="h-3.5 w-3.5" />
            New client
          </Button>
        )}
        </div>
      </div>

      {/* Results */}
      <div className="overflow-hidden rounded-lg border border-border/60">
        {state === "loading" ? (
          <div className="divide-y divide-border/40" role="status" aria-label="Loading clients">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-40" />
                  <Skeleton className="h-3 w-56" />
                </div>
                <Skeleton className="h-5 w-14 rounded-full" />
              </div>
            ))}
          </div>
        ) : state === "error" ? (
          <div className="p-3">
            <Alert variant="destructive" role="alert">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>The client register could not be reached</AlertTitle>
              <AlertDescription className="space-y-2">
                <p className="text-xs">{error}</p>
                <Button
                  type="button" size="sm" variant="outline"
                  onClick={() => void load(0)}
                >
                  Try again
                </Button>
              </AlertDescription>
            </Alert>
          </div>
        ) : clients.length === 0 ? (
          <div
            className="flex flex-col items-center gap-1.5 px-4 py-8 text-center"
            role="status"
          >
            <Users aria-hidden="true" className="h-5 w-5 text-muted-foreground" />
            {/*
              Three different nothings, said differently. "No clients match"
              on an empty register would be a lie, and it is the answer that
              makes somebody create a duplicate.
            */}
            {stale && browsing ? (
              /*
                The server predates browsing, so it answered `[]` to an empty
                query. That is not an empty register and must never be shown
                as one — search still reaches every client, so say that.
              */
              <>
                <p className="text-sm font-medium">Type a name to find a client</p>
                <p className="max-w-xs text-xs text-muted-foreground">
                  Browsing the full register needs the updated server. Search
                  works now and covers every client.
                </p>
              </>
            ) : !browsing ? (
              <>
                <p className="text-sm font-medium">No client matches “{debounced}”</p>
                <p className="max-w-xs text-xs text-muted-foreground">
                  Try a surname on its own, or clear the search to browse the
                  whole register.
                </p>
              </>
            ) : status !== "all" ? (
              <>
                <p className="text-sm font-medium">
                  No {status} clients
                </p>
                <p className="max-w-xs text-xs text-muted-foreground">
                  Switch to All clients to see the rest of the register.
                </p>
              </>
            ) : (
              <>
                <p className="text-sm font-medium">No clients yet</p>
                <p className="max-w-xs text-xs text-muted-foreground">
                  Create the first client here, or in Client Management —
                  it is the same register either way.
                </p>
              </>
            )}
            {/*
              Offered on the two empty states where creating is plausibly the
              right move — an unmatched search and an empty register — and NOT
              on an empty status filter, where the client probably exists in
              the slice next door.
            */}
            {onCreateNew && (status === "all" || !browsing) && !stale && (
              <Button
                type="button" size="sm" variant="outline"
                className="mt-1 h-7 gap-1.5 px-2.5 text-xs"
                disabled={disabled}
                onClick={onCreateNew}
              >
                <UserPlus aria-hidden="true" className="h-3.5 w-3.5" />
                Create a new client
              </Button>
            )}
          </div>
        ) : (
          <ul className="max-h-64 divide-y divide-border/40 overflow-y-auto" aria-label="Clients">
            {clients.map((c) => {
              const blocked = c.has_open_case;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    disabled={disabled || blocked}
                    aria-label={
                      blocked
                        ? `${c.label} — already has an open case`
                        : `Select ${c.label}`
                    }
                    className={cn(
                      "flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors",
                      blocked
                        ? "cursor-not-allowed opacity-60"
                        : "hover:bg-accent focus:outline-none focus-visible:bg-accent",
                    )}
                    onClick={() => { if (!blocked) onSelect(c); }}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{c.label}</span>
                      {c.email && (
                        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                          <Mail aria-hidden="true" className="h-3 w-3 shrink-0" />
                          <span className="truncate">{c.email}</span>
                        </span>
                      )}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {blocked ? (
                        /*
                          Naming the case turns "you cannot do this" into
                          "here is the case that already covers it".
                        */
                        <Badge
                          variant="outline"
                          className="gap-1 border-warning/40 bg-warning/10 text-warning"
                        >
                          <FolderOpen aria-hidden="true" className="h-3 w-3" />
                          {c.open_case?.case_reference ?? "Open case"}
                        </Badge>
                      ) : (
                        <ClientStatusBadge active={c.is_active} />
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Count + paging */}
      {state === "ready" && clients.length > 0 && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {countLabel}
          </p>
          {hasMore && (
            <Button
              type="button" size="sm" variant="outline"
              className="h-7 px-3 text-xs"
              disabled={disabled || loadingMore}
              onClick={() => void load(clients.length)}
            >
              {loadingMore && <Loader2 aria-hidden="true" className="mr-1.5 h-3 w-3 animate-spin" />}
              Load more
            </Button>
          )}
        </div>
      )}

      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <Check aria-hidden="true" className="mt-0.5 h-3 w-3 shrink-0" />
        Every client in the register is listed here. Selecting an inactive
        client activates them as part of this form — nothing needs re-entering.
      </p>
    </div>
  );
}
