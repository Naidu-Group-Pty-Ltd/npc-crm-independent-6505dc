# Internal messaging — desktop alerts

How a Command Centre user finds out about an internal team message while they
are somewhere else: another browser tab, another window, or simply another page
or module of the dashboard.

Code: [`src/lib/desktopMessageAlerts.ts`](../src/lib/desktopMessageAlerts.ts),
[`src/components/agent/InternalMessageToasts.tsx`](../src/components/agent/InternalMessageToasts.tsx),
[`public/sw-push.js`](../public/sw-push.js),
[`src/components/settings/DesktopMessageAlertsToggle.tsx`](../src/components/settings/DesktopMessageAlertsToggle.tsx).
Contract tests: [`src/lib/__tests__/desktopMessageAlertsContract.test.ts`](../src/lib/__tests__/desktopMessageAlertsContract.test.ts).

## Where the signal comes from

Internal messaging tables are `service_role`-only, so the browser gets no
Postgres change stream. `internalMessagingBus` broadcasts a content-free
"something happened in thread X" hint, and `InternalMessageToasts` re-fetches
through the `internal-messaging` edge function, which re-verifies participation
server-side. A 15s poll (plus a re-sync on `visibilitychange` / `focus`, since
background tabs have their timers throttled) is the safety net when a broadcast
is missed.

**Nothing on this path trusts message content from the wire.** The preview shown
in a notification is the `last_message_preview` returned by the edge function
for a thread the caller is a verified participant of.

`InternalMessageToasts` is mounted in `DashboardLayout` on both the mobile and
the desktop shell, so the alert engine runs on every internal dashboard route —
not only on the messaging surface.

## Four layers, each covering the one below

| Layer | Needs permission? | Covers |
| --- | --- | --- |
| OS notification (service worker, else page-level) | Yes | Tab backgrounded, window minimised, browser behind another app |
| Tab title + favicon count badge | No | Tab visible but not focused |
| Audible ping | No | Either of the above; separately switchable |
| In-app chip dock + catch-up toast | No | Everything, including permission denied / unsupported |

`deliverDesktopMessageAlert` reports **why** an alert did or did not reach the
OS, and the caller acts on it:

- `shown` — the bubble is up; play the ping and stop.
- `suppressed-focused` — the user is looking at this tab, so the chip dock has
  already told them. This is a deliberate suppression, **not** a failure, and it
  must not produce a fallback toast.
- `disabled` / `denied` / `unsupported` / `failed` — the OS route is unavailable,
  so the message is queued for the catch-up toast that fires the next time the
  user looks at this tab ("3 new team messages … From Priya, Sam"), carrying an
  **Open** action straight into the latest conversation.

### What a notification says and does

Heading is the sender (`Priya Naidu`), the sender and the room for a group
(`Priya Naidu in Acquisitions`), or `Announcement · <title>` for a broadcast;
urgent messages are prefixed `🔴 Urgent ·` and use `requireInteraction` so they
stay on screen until acknowledged. The body is the message preview, collapsed to
one line and capped at 180 characters, falling back to "Sent an attachment" for
an attachment-only message.

Clicking it returns the user to the conversation. Where a service worker is
available the click is handled there: it focuses an already-open dashboard and
`postMessage`s it — **it does not navigate the tab**, so whatever the user was
working on is preserved. Only when no window is open does it cold-start one at
`/?internalThread=<id>`, which `consumeInternalThreadDeepLink()` reads and
strips on boot. Either path ends in `requestPopOutInternalThread`, the same
free-floating conversation window the rest of the feature uses.

## Branding — what logo appears on the notification

A notification is the one surface that renders **outside** the app, in the OS
notification shade next to the browser's own name. A stock scaffold icon there
is a branding leak, so `/favicon.ico` is used on no notification path at all.
The resolution chain is:

1. **The tenant's white-label logo.** `BrandProvider` publishes it through
   `setBrandNotificationIcon()` whenever branding resolves, using the same
   square-mark chain as the favicon (`favicon` → `sidebarIcon` → `sidebarLogo`
   → `authLogo`), so uploading a logo under White Label automatically rebrands
   every alert. Removing it publishes `null` and reverts.
2. **The Aurixa Systems mark** (`public/brand/aurixa-notification-192.png`) when
   no white-label logo is configured.

The stock icon is refused defensively: `setBrandNotificationIcon('/favicon.ico')`
is treated as "no logo". The same chain feeds the favicon badge, so the count is
stamped on the tenant's mark rather than on a stock one, and `index.html` now
declares the Aurixa icon explicitly instead of letting the browser guess
`/favicon.ico`. Resolved icons are absolutised, because a service worker
resolves a relative icon against its own scope rather than the page, and a 404
icon is a silently unbranded notification.

**Redirecting the references was not enough.** `public/favicon.ico` was itself
the scaffold's stock heart — a 73×74 PNG simply named `.ico` — and it stayed
reachable at that URL through a cached manifest, a platform-injected tag, or
Chromium's own fallback when a notification icon fails to load. That file is now
generated from the brand source as a real multi-size ICO (16/32/48/64/128/256),
and a contract test pins the stock file's sha256 so it cannot return through a
dependency bump or a scaffold regeneration.

The `badge` slot is deliberately **not** white-labelled. Android renders it as a
monochrome status-bar glyph — it keeps the alpha channel and discards the colour
— so a client's full-colour logo comes back as a grey block. That slot always
carries the flat Aurixa delta (`aurixa-badge-96.png`).

The artwork is generated, not hand-drawn: `public/brand/*.svg` are the sources,
and `npm run brand:icons` rasterises them through Chromium (Chromium does not
reliably decode SVG for `Notification.icon`) into the notification PNGs, the
badge glyph and `favicon.ico`. `npm run brand:icons:check` fails if the
committed output is stale, and skips with a warning where no browser is
available.

### The default artwork, and how to replace it

The shipped default is the **official Aurixa Systems logo**, imported from the
brand file and committed as `public/brand/aurixa-source.jpg`. Everything else —
the 192/512 notification icons and all six `favicon.ico` sub-images — is
rendered from it, so there is one master and no hand-edited binaries.

To replace it, hand the build a new file: a local path, or any URL, including a
Supabase public `branding-assets` URL.

```bash
npm run brand:import -- ./logo.png --crop 348,118,382,382
npm run brand:import -- https://…/storage/v1/object/public/branding-assets/…/logo.png
npm run brand:icons                 # re-render from the current master
npm run brand:icons -- --reset      # fall back to the bundled vector
```

**`--crop x,y,w,h` matters more than it looks.** Brand artwork arrives as a
lockup — symbol, wordmark, backdrop. The Aurixa file is 1080×720 with the
wordmark beneath the delta; contain-fitting that into a 48px notification icon
gives a letterboxed strip with an illegible wordmark. Icons want the symbol
alone, so the rectangle is measured once and recorded in
`aurixa-source.crop.json` rather than re-derived at render time — reproducible,
and reviewable in a diff.

For the current master, the delta measures x 360–718, y 133–492 and the
wordmark's ink begins at y≈507, leaving a clean gap at 494–508. The committed
crop is `348,118,382,382`: the symbol and its orbital rings, nothing else.

**Icons are rendered edge to edge, with no corner radius.** Baking a rounded
shape into the bitmap and screenshotting it opaquely left solid white outside
the curve — four white corners on every notification. Platforms already mask
icons to their own shape (Windows squares them, Android may circle them), so
the artwork stays square and lets the OS decide. A pixel-level test samples all
four corners of the committed PNGs to keep it that way.

Three things the importer does on purpose:

- **Keeps one master.** Importing removes any previous `aurixa-source.*` and any
  stale crop, so a later run cannot silently pick the wrong file — or apply a
  rectangle measured against a different image.
- **Places the crop from the image's natural size**, not a CSS percentage. A
  percentage resolves against the tile, which scaled the artwork wrongly and let
  the wordmark show through the bottom of the icon.
- **Never touches the badge.** Android renders `badge` as a monochrome glyph,
  keeping only its alpha, so a full-colour logo returns as a grey block. That
  slot always uses `aurixa-badge.svg`.

Without a crop, a source is centred with `object-fit: contain` so a
transparent, square or wide export all survive uncropped.

Two mark variants exist because one drawing cannot serve both ends of the size
range: `aurixa-mark.svg` carries the orbital rings, the warm bloom and the
speculars, and feeds everything from 48px up; `aurixa-mark-compact.svg` drops
all of it and feeds the 16/32px favicon entries, where that detail resamples
into noise. Both share the same derived delta geometry, so the silhouette is
identical.

### Verifying a deployment

`npm run verify:branding -- https://your-site.example` probes the **live** site
and reports whether it is actually serving branded artwork.

This exists because the branding fix was merged and the stock heart kept
appearing in production anyway. Every repository check was green throughout —
correctly, because the repository was right. The site had simply never been
rebuilt and republished, and no repo-side test can observe that.

**It then gave a false green, which is worth recording.** Once the artwork was
replaced with the official logo, the deployment still served the previous
generation — right shape, wrong build — and every check passed, because each
only asked *"is the heart gone and is something branded being served?"* Both
were true. Presence is not freshness.

So it compares the served **bytes** against the committed ones. Identical, or it
is not this build.

| Probe | Stale build looks like |
| --- | --- |
| `/favicon.ico` | the stock heart's sha256, header `89504e47` (a PNG, not an ICO) |
| every committed brand asset | a different sha256 — reported as `an OLDER BUILD is live` — or `404` |
| `/sw-push.js` | still contains `data.icon \|\| '/favicon.ico'` |

Run it from an up-to-date checkout: the comparison is against your working
tree, so a stale checkout reports a mismatch it caused itself.

Two things to know when a human still reports the old icon after a good deploy:

- **Browsers cache favicons and service workers hard.** A hard reload, a new
  tab, or a fresh profile may be needed before the change is visible. The
  notification icon itself comes from the page, so it corrects as soon as the
  new bundle loads.
- **A configured white-label logo wins, by design.** With one uploaded, alerts
  show *that*, not the Aurixa mark — so "still not the Aurixa logo" can be the
  system working correctly. Note that notification shades render the icon at
  roughly 48px: a large asset with wide margins reads as a near-empty box, so
  the favicon slot wants a square, tightly-cropped mark.

## Duplicate prevention

Every open dashboard tab polls independently, so the naive "already alerted"
map fires once **per tab**, and again after every reload. Instead, alerts are
gated on a shared claim ledger (`claimMessageAlert`) keyed by thread ID and the
message's timestamp:

- persisted in `localStorage`, so a reload, a route change or a re-login cannot
  replay a notification;
- mirrored over a `BroadcastChannel` (plus the `storage` event), so two tabs
  polling at the same instant cannot both win;
- keyed by timestamp rather than by thread, so a **later** message in the same
  conversation still claims and still notifies — it is duplicates that are
  suppressed, never follow-ups;
- pruned after 24 hours and capped at 200 entries;
- reset when the signed-in user changes, since the ledger is per-person.

Notifications also carry `tag: aurixa-internal-<thread_id>`, so even if two
bubbles were raised, the OS collapses them into one per conversation rather than
stacking a wall of alerts.

On a fresh load the first sweep **seeds** the ledger instead of alerting:
signing in with ten unread threads gives ten chips, not ten OS notifications.
Messages timestamped after this mount booted are exempt from seeding, so a
genuinely new message is not swallowed by the first sweep (this is also what
keeps the desktop↔mobile layout swap, which remounts the component, from
dropping an alert).

Opening a conversation — from a chip, a pop-out, or a notification — closes any
bubble still showing for it and drops it from the catch-up summary.

## Permission

Permission is never requested on page load and never from a hidden gesture. The
user is offered it once, in context, as a toast with **Enable** / **Not now**;
the browser prompt is raised from that button's own click. The invitation only
appears to people who actually have internal conversations, and never on the
first poll after landing.

- **Enable** or **Not now** → answered, never asked again in-app.
- Ignored/auto-closed → snoozed for seven days.
- Settings → **Team Message Alerts** is the durable way in and out: it shows the
  live permission state, requests it, toggles alerts and the sound
  independently, sends a test alert, and explains what to do when notifications
  are blocked at the browser level.

Switching alerts off leaves every other layer working — the tab title, the
favicon count and the message dock still flag unread messages. The service
worker is only registered once permission has actually been granted, and never
in the editor preview or an iframe, where it would fail anyway; in those
contexts alerts fall back to the page-level `Notification` constructor.

## Deliberately unchanged

Message fetching, thread participation checks, priorities, attachments, typing
presence, the chip dock's minimise/expand/dismiss rules, the pop-out window and
the Aurixa widget's unread badge all behave exactly as before. This work adds
signalling around the existing messaging feature; it changes none of its
workflows or permissions.
