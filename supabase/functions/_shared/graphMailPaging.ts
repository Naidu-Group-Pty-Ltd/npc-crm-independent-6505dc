/**
 * Reading a Microsoft 365 mailbox as far as it goes, in both directions.
 *
 * ## What this replaces
 *
 * Two functions asked Graph for mail and neither followed the pager.
 * `outlook-email-sync` issued `?$top=${limit}` once per folder and returned
 * `data.value`; `email-sync-cron` did the same with a hardcoded `$top=30`.
 * `@odata.nextLink` was never read by either, so the Email Co-Pilot could hold
 * the most recent page of each folder and, structurally, nothing else.
 * Measured 13 Sep 2026 on the same mailbox: the clone held 101 rows against
 * the prime's 5,677 — 1.8% — and no amount of re-syncing would ever have
 * closed it, because the second page was never requested.
 *
 * It lives here rather than in either function because it was already written
 * twice and the two copies had already drifted (30 versus a caller-supplied
 * limit; inbox-only versus inbox-and-sent). A third copy is how a fix lands in
 * one of them.
 *
 * ## Two rules that are easy to get wrong
 *
 * **A `nextLink` is opaque and complete.** It already carries `$top`,
 * `$select`, `$orderby` and any `$filter`; appending to it or rebuilding it
 * from parts is how a paginator silently starts re-reading page one for ever.
 * It is followed verbatim or not at all.
 *
 * **"No more pages" and "out of budget" are different answers.** Graph
 * offering no `nextLink` means the mailbox is exhausted in that direction and
 * a backfill is genuinely finished. Stopping on a deadline means come back.
 * Collapsing them makes a half-read mailbox report itself complete, which is
 * indistinguishable from a working import and is exactly the failure this
 * module exists to end.
 */

export const GRAPH_MAIL_SELECT =
  "id,internetMessageId,conversationId,subject,bodyPreview,body,from,toRecipients,ccRecipients,bccRecipients,receivedDateTime,sentDateTime,isRead,hasAttachments";

/** Graph accepts `$top` up to 1000; 100 keeps a page carrying bodies sane. */
export const GRAPH_MAIL_PAGE_SIZE = 100;

export type MailFolder = "inbox" | "sent";

/** The property both `$orderby` and `$filter` must name, per folder. */
export function dateFieldFor(folder: MailFolder | string): string {
  return folder === "sent" ? "sentDateTime" : "receivedDateTime";
}

/**
 * **Both branches name a FOLDER.** The inbox branch used to fall through to
 * `/users/{email}/messages`, which is not the Inbox — Graph documents it as
 * every message in the mailbox, Sent Items, Drafts, Deleted Items, Junk and
 * Archive included.
 *
 * It was nearly invisible while the read was one `$top=30` page of the newest
 * mail. The backfill made it structural: walking that path backwards imported
 * the team's own outbound mail, drafts and deleted mail into Email Co-Pilot as
 * unread incoming correspondence. Measured on the prime 13 Sep 2026, the whole
 * of it landed in ONE hour (07:00–08:00 UTC): 2,303 rows, every one written
 * `folder = 'inbox'` and `status = 'unread'`, carrying `received_at` between
 * 2025-01-27 and 2025-11-24.
 *
 * **How much of that is repairable by SQL was measured, and it is less than it
 * first looked.** Two signatures were proposed and neither survives:
 *
 *   - 934 rows in `folder = 'inbox'` whose sender is our own domain — but 660
 *     of those pre-date the incident. A colleague emailing you lands in your
 *     Inbox and belongs there, so an own-domain sender is an ordinary inbox
 *     state rather than a marker of anything.
 *   - 34 messages present in BOTH folders — real, and every one created
 *     between January and 2 September 2026. Not one is in the damage hour.
 *     Inside it, the (subject, received_at) and (conversation_id, received_at)
 *     cross-folder tests both return ZERO.
 *
 * So nothing stored can tell a wrongly-filed row from a real one, and re-filing
 * on a guess would HIDE real inbox mail. **The folder is repaired by re-reading
 * Graph through the corrected path above, never by SQL.**
 *
 * What IS decidable is the arrival stamp, and that is what
 * `20261119190000_email_backfill_was_not_an_arrival.sql` repairs: mail already
 * more than thirty days old when it was imported was never a new arrival. The
 * bell it rang is the larger harm — 9,196 notifications in that hour, four
 * recipients times ~2,299 messages, against three to six in every other hour
 * of the preceding three days.
 */
export function mailboxPathFor(
  mailboxEmail: string,
  folder: MailFolder | string,
): string {
  return folder === "sent"
    ? `https://graph.microsoft.com/v1.0/users/${mailboxEmail}/mailFolders/sentitems/messages`
    : `https://graph.microsoft.com/v1.0/users/${mailboxEmail}/mailFolders/inbox/messages`;
}

/**
 * A database timestamp rendered as the DateTimeOffset Graph's `$filter` needs.
 *
 * `received_at` comes back from PostgREST as `2025-11-24T01:11:04` — no zone
 * designator — and OData rejects that outright:
 *
 *   Invalid filter clause: The DateTimeOffset text '2025-11-24T01:11:04'
 *   should be in format 'yyyy-mm-ddThh:mm:ss('.'s+)?(zzzzzz)?'
 *
 * Measured on the prime, 13 Sep 2026: every backfill tick between 05:44 and
 * 06:50 answered 400 on exactly that, roughly one every five minutes.
 *
 * The zone is APPENDED rather than left to the runtime, because ECMAScript
 * parses a date-TIME form with no offset as LOCAL time (a date-only form as
 * UTC — the two forms disagree, which is the trap). These values are stored
 * UTC, so `Z` is the truth; inferring it from the container's TZ would make
 * the boundary depend on where the function happens to run.
 *
 * Answers null for anything it cannot read, so the one caller that must not
 * proceed without a boundary can say so rather than silently walking the
 * whole mailbox.
 */
export function graphDateTimeOffset(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const hasZone = /(?:[Zz]|[+-]\d{2}:?\d{2})$/.test(raw);
  // PostgREST can also hand back a space separator rather than `T`.
  const ms = Date.parse(hasZone ? raw : `${raw.replace(" ", "T")}Z`);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

export function firstPageUrl(
  mailboxEmail: string,
  folder: MailFolder | string,
  pageSize: number,
  olderThanIso?: string | null,
): string {
  const dateField = dateFieldFor(folder);
  const params = [
    `$top=${Math.min(GRAPH_MAIL_PAGE_SIZE, Math.max(1, pageSize))}`,
    `$orderby=${dateField} desc`,
    `$select=${GRAPH_MAIL_SELECT}`,
  ];
  // The backfill's entire resume mechanism: "older than the oldest I already
  // hold" needs no stored cursor, cannot go stale, and converges even when an
  // invocation dies halfway, because the next one re-derives the boundary from
  // what is actually in the table.
  //
  // A boundary that was ASKED FOR and cannot be rendered is refused here
  // rather than dropped. Dropping it would return the NEWEST page instead of
  // the oldest — every row already held, no history ever reached, and the walk
  // reporting pages fetched the whole time.
  if (olderThanIso !== null && olderThanIso !== undefined && String(olderThanIso).trim() !== "") {
    const bound = graphDateTimeOffset(olderThanIso);
    if (bound === null) {
      throw new Error(
        `cannot read the backfill boundary ${JSON.stringify(olderThanIso)} as a timestamp`,
      );
    }
    params.push(`$filter=${dateField} lt ${bound}`);
  }
  return `${mailboxPathFor(mailboxEmail, folder)}?${params.join("&")}`;
}

export interface MailPage<T> {
  readonly messages: T[];
  /** Followed verbatim on the next call, or null when the folder is spent. */
  readonly nextLink: string | null;
}

/**
 * One page of a Graph collection, and the link to the next.
 *
 * The rest of this module is about mail, but THIS function is not: a Graph
 * collection page is a `value` array plus an optional `@odata.nextLink`
 * whatever the collection holds, and the opaque-nextLink rule above is the
 * same rule for all of them. `outlook-calendar`'s `listEvents` reads
 * `/calendarView` through it rather than growing a second paginator, because
 * that function had exactly the defect this module was written for — one
 * `$top=200` request, `@odata.nextLink` never read, ordered by start time, so
 * a calendar with more than 200 events in the window silently lost the END of
 * the period and the page drew a month that emptied partway through.
 *
 * `extraHeaders` exists for that caller: `/calendarView` needs
 * `Prefer: outlook.timezone="UTC"` or Graph answers in the mailbox's own
 * timezone, and every consumer here treats the times it returns as UTC.
 */
export async function fetchMailPage<T = unknown>(
  accessToken: string,
  url: string,
  label = "graph-mail",
  extraHeaders: Record<string, string> = {},
): Promise<MailPage<T>> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...extraHeaders,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `[${label}] Graph returned ${response.status}: ${errorText}`,
    );
  }

  const data = await response.json();
  return {
    messages: (data?.value ?? []) as T[],
    nextLink:
      typeof data?.["@odata.nextLink"] === "string"
        ? data["@odata.nextLink"]
        : null,
  };
}

export interface MailWindow {
  /** Stop once this many messages are in hand. */
  readonly max: number;
  /** Stop once `Date.now()` passes this. Absent means no clock limit. */
  readonly deadline?: number;
  /** Only messages strictly older than this ISO timestamp. */
  readonly olderThanIso?: string | null;
  /** Hard ceiling on pages, so a pathological mailbox cannot spin. */
  readonly maxPages?: number;
}

export interface MailWindowResult<T> {
  readonly messages: T[];
  /**
   * True only when GRAPH offered no further page — the folder is spent in this
   * direction. False means we stopped early and there is more to collect.
   * Never inferred from an empty page alone.
   */
  readonly exhausted: boolean;
  readonly pages: number;
  /** True when the stop was a deadline rather than the end of the folder. */
  readonly stoppedOnBudget: boolean;
}

export async function fetchMailWindow<T = unknown>(
  accessToken: string,
  mailboxEmail: string,
  folder: MailFolder | string,
  window: MailWindow,
  label = "graph-mail",
): Promise<MailWindowResult<T>> {
  const max = Math.max(1, Math.floor(window.max));
  const maxPages = Math.max(1, Math.floor(window.maxPages ?? 100));
  const collected: T[] = [];

  let url: string | null = firstPageUrl(
    mailboxEmail,
    folder,
    max,
    window.olderThanIso,
  );
  let pages = 0;
  let stoppedOnBudget = false;

  while (url && collected.length < max && pages < maxPages) {
    const page: MailPage<T> = await fetchMailPage<T>(accessToken, url, label);
    pages += 1;
    collected.push(...page.messages);
    url = page.nextLink;

    // An empty page with no nextLink is the end. An empty page WITH a nextLink
    // happens when a $filter excludes everything on that page, and following
    // it is how the walk gets past a quiet stretch.
    if (page.messages.length === 0 && !url) break;
    if (window.deadline !== undefined && Date.now() > window.deadline) {
      stoppedOnBudget = true;
      break;
    }
  }

  return {
    messages: collected.slice(0, max),
    // Exhausted only if Graph itself ran out, and only if we did not cut the
    // walk short for our own reasons.
    exhausted: url === null && !stoppedOnBudget,
    pages,
    stoppedOnBudget,
  };
}
