import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Settings2 } from 'lucide-react';

export type MigrationDomain = 'contacts' | 'opportunities' | 'conversations' | 'conversations_replay' | 'notes' | 'calendar_groups' | 'calendars' | 'bookings';

export type BookingsMode = 'all' | 'future_only' | 'window';

export interface AdvancedFlagsState {
  // Contacts (existing — kept for parity, controlled by parent)
  preserve_csv_structure: boolean;
  force_reingest: boolean;
  reuse_existing_mappings: boolean;
  bypass_sanitizer: boolean;

  // Opportunities
  force_recreate_opportunities: boolean;
  skip_target_dedupe_check: boolean;
  only_low_confidence: boolean;
  include_closed_statuses: boolean;
  pipeline_filter: string; // comma-separated names
  stage_filter: string;    // comma-separated names
  assigned_user_strategy: 'single' | 'map_by_email' | 'omit';
  /** Range/offset operator controls — workaround for GHL ordering quirks. */
  skip_count: string;       // numeric string; '' = no skip
  start_after_iso: string;  // ISO timestamp; '' = no seed
  start_after_id: string;   // optional companion to start_after_iso

  // Conversations
  message_direction: 'all' | 'inbound' | 'outbound';
  channel_filter: string; // e.g. "SMS,Email"
  date_range_days: string; // numeric string; '' = no limit
  skip_attachments: boolean;

  // Notes (also reused by conversations_replay)
  force_overwrite_existing: boolean;
  min_content_length: string; // numeric string
  prefix_legacy_marker: boolean;

  // Conversations replay
  skip_activity: boolean;
  max_messages_per_conv: string; // numeric string; '' = no cap

  // Calendars
  default_user_id: string; // target-account userId fallback when no team members map

  // Bookings
  bookings_mode: BookingsMode;
  bookings_start_date: string; // ISO date (YYYY-MM-DD), used when mode='window'
  bookings_end_date: string;   // ISO date (YYYY-MM-DD), used when mode='window'
  bookings_lookback_days: string; // numeric, used when mode='future_only'
  bookings_notify_attendees: boolean;
}

export const DEFAULT_ADVANCED_FLAGS: AdvancedFlagsState = {
  preserve_csv_structure: true,
  force_reingest: true,
  reuse_existing_mappings: false,
  bypass_sanitizer: false,

  force_recreate_opportunities: false,
  skip_target_dedupe_check: false,
  only_low_confidence: false,
  include_closed_statuses: false,
  pipeline_filter: '',
  stage_filter: '',
  assigned_user_strategy: 'single',
  skip_count: '',
  start_after_iso: '',
  start_after_id: '',

  message_direction: 'all',
  channel_filter: '',
  date_range_days: '',
  skip_attachments: false,

  force_overwrite_existing: false,
  min_content_length: '',
  prefix_legacy_marker: false,

  skip_activity: true,
  max_messages_per_conv: '',

  default_user_id: '',

  bookings_mode: 'all',
  bookings_start_date: '',
  bookings_end_date: '',
  bookings_lookback_days: '7',
  bookings_notify_attendees: false,
};

/**
 * Build a domain-scoped payload patch from the flag state.
 * Only emits keys that the selected worker actually honours, so other workers
 * never receive (and silently ignore) flags that don't apply.
 */
export function buildDomainPayloadPatch(domain: MigrationDomain, f: AdvancedFlagsState): Record<string, any> {
  if (domain === 'contacts') {
    return {
      preserve_csv_structure: f.preserve_csv_structure,
      force_reingest: f.force_reingest,
      reuse_existing_mappings: f.reuse_existing_mappings,
      allow_name_dedupe: f.reuse_existing_mappings,
      bypass_sanitizer: f.bypass_sanitizer,
    };
  }
  if (domain === 'opportunities') {
    const splitCsv = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
    const skipN = parseInt(f.skip_count, 10);
    const seedIso = f.start_after_iso.trim();
    const seedId = f.start_after_id.trim();
    return {
      force_recreate_opportunities: f.force_recreate_opportunities,
      skip_target_dedupe_check: f.skip_target_dedupe_check,
      only_low_confidence: f.only_low_confidence,
      include_closed_statuses: f.include_closed_statuses,
      ...(f.pipeline_filter ? { pipeline_filter: splitCsv(f.pipeline_filter) } : {}),
      ...(f.stage_filter ? { stage_filter: splitCsv(f.stage_filter) } : {}),
      assigned_user_strategy: f.assigned_user_strategy,
      ...(Number.isFinite(skipN) && skipN > 0 ? { skip_count: skipN } : {}),
      ...(seedIso ? { start_after_iso: seedIso } : {}),
      ...(seedId ? { start_after_id: seedId } : {}),
    };
  }
  if (domain === 'conversations') {
    const splitCsv = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
    const days = parseInt(f.date_range_days, 10);
    return {
      message_direction: f.message_direction,
      ...(f.channel_filter ? { channel_filter: splitCsv(f.channel_filter) } : {}),
      ...(Number.isFinite(days) && days > 0 ? { date_range_days: days } : {}),
      skip_attachments: f.skip_attachments,
    };
  }
  if (domain === 'notes') {
    const minLen = parseInt(f.min_content_length, 10);
    return {
      force_overwrite_existing: f.force_overwrite_existing,
      ...(Number.isFinite(minLen) && minLen > 0 ? { min_content_length: minLen } : {}),
      prefix_legacy_marker: f.prefix_legacy_marker,
    };
  }
  if (domain === 'conversations_replay') {
    const splitCsv = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
    const days = parseInt(f.date_range_days, 10);
    const maxMsgs = parseInt(f.max_messages_per_conv, 10);
    return {
      force_overwrite_existing: f.force_overwrite_existing,
      skip_attachments: f.skip_attachments,
      skip_activity: f.skip_activity,
      prefix_legacy_marker: f.prefix_legacy_marker,
      ...(f.channel_filter ? { channel_filter: splitCsv(f.channel_filter).map((s) => s.toLowerCase()) } : {}),
      ...(Number.isFinite(days) && days > 0 ? { date_range_days: days } : {}),
      ...(Number.isFinite(maxMsgs) && maxMsgs > 0 ? { max_messages_per_conv: maxMsgs } : {}),
    };
  }
  if (domain === 'calendars') {
    const uid = f.default_user_id.trim();
    return uid ? { default_user_id: uid } : {};
  }
  if (domain === 'bookings') {
    const patch: Record<string, any> = {
      mode: f.bookings_mode,
      notify_attendees: f.bookings_notify_attendees,
    };
    const uid = f.default_user_id.trim();
    if (uid) patch.default_assigned_user_id = uid;
    if (f.bookings_mode === 'window') {
      if (f.bookings_start_date) patch.start_date = new Date(f.bookings_start_date).toISOString();
      if (f.bookings_end_date) patch.end_date = new Date(f.bookings_end_date).toISOString();
    }
    if (f.bookings_mode === 'future_only') {
      const lb = parseInt(f.bookings_lookback_days, 10);
      if (Number.isFinite(lb) && lb > 0) patch.future_only_lookback_days = lb;
    }
    return patch;
  }
  return {};
}

interface Props {
  domain: MigrationDomain;
  flags: AdvancedFlagsState;
  onChange: (next: AdvancedFlagsState) => void;
}

const Toggle: React.FC<{
  checked: boolean;
  onChange: (v: boolean) => void;
  title: string;
  description: React.ReactNode;
  destructive?: boolean;
}> = ({ checked, onChange, title, description, destructive }) => (
  <div className={`rounded-md border p-3 ${destructive && checked ? 'border-destructive/60 bg-destructive/10' : 'border-border/60 bg-muted/20'}`}>
    <label className="flex items-start gap-2 text-xs">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5"
      />
      <span>
        <strong>{title}</strong>
        <div className="mt-1 text-muted-foreground">{description}</div>
      </span>
    </label>
  </div>
);

const TextField: React.FC<{
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  description?: string;
  type?: 'text' | 'number';
}> = ({ label, value, onChange, placeholder, description, type = 'text' }) => (
  <div className="rounded-md border border-border/60 bg-muted/20 p-3 space-y-1.5">
    <label className="text-xs font-medium">{label}</label>
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-md border bg-background px-3 py-1.5 text-sm"
    />
    {description && <p className="text-[11px] text-muted-foreground">{description}</p>}
  </div>
);

export const MigrationAdvancedOptions: React.FC<Props> = ({ domain, flags, onChange }) => {
  const set = <K extends keyof AdvancedFlagsState>(k: K, v: AdvancedFlagsState[K]) =>
    onChange({ ...flags, [k]: v });

  return (
    <div className="rounded-md border border-primary/30 bg-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Settings2 className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">Advanced options</h3>
        <Badge variant="outline" className="text-[10px] uppercase">{domain}</Badge>
        <span className="ml-auto text-[11px] text-muted-foreground">
          Only flags supported by the <strong>{domain}</strong> worker are shown.
        </span>
      </div>

      {domain === 'contacts' && (
        <div className="space-y-3">
          <Toggle
            checked={flags.preserve_csv_structure}
            onChange={(v) => set('preserve_csv_structure', v)}
            title="Preserve legacy CSV structure (recommended)"
            description={<>Keep original source/list-like grouping signals (legacy <code>source</code>, tags, and metadata columns) instead of flattening all contacts under one export source.</>}
          />
          <Toggle
            checked={flags.force_reingest}
            onChange={(v) => set('force_reingest', v)}
            title="Force create-first contact writes (recommended after target wipe)"
            description={<>Ignore stale ID mappings and attempt individual <code>POST /contacts/</code> writes before any duplicate fallback.</>}
          />
          <Toggle
            checked={flags.reuse_existing_mappings}
            onChange={(v) => set('reuse_existing_mappings', v)}
            title="Reuse existing mappings / name matches"
            description="Off for wiped target accounts. Only enable when the target GHL account already contains trusted contacts that should be reused instead of created."
          />
          <Toggle
            destructive
            checked={flags.bypass_sanitizer}
            onChange={(v) => set('bypass_sanitizer', v)}
            title="⚠ Bypass sanitizer — force 100% migration"
            description={<>Copies <em>every</em> legacy contact, even those with junk names or no email/phone. Synthetic placeholders are tagged for cleanup.</>}
          />
        </div>
      )}

      {domain === 'opportunities' && (
        <div className="space-y-3">
          <Toggle
            checked={flags.force_recreate_opportunities}
            onChange={(v) => set('force_recreate_opportunities', v)}
            title="Force recreate opportunities"
            description={<>Bypass existing <code>ghl_id_mapping</code> rows and create fresh opportunities in the target. Use after a target-account wipe.</>}
          />
          <Toggle
            checked={flags.skip_target_dedupe_check}
            onChange={(v) => set('skip_target_dedupe_check', v)}
            title="Skip target dedupe check"
            description="Disables the strict name + monetaryValue matcher. Faster on empty target accounts, but unsafe if data already exists in the target."
          />
          <Toggle
            checked={flags.only_low_confidence}
            onChange={(v) => set('only_low_confidence', v)}
            title="Only re-process low-confidence mappings"
            description="Re-runs the matcher only for items previously marked low confidence (e.g. ambiguous 3:1 collisions). Safer than a full force-recreate."
          />
          <Toggle
            checked={flags.include_closed_statuses}
            onChange={(v) => set('include_closed_statuses', v)}
            title="Include closed statuses (won/lost/abandoned)"
            description="By default the worker skips closed deals. Enable to migrate historical closed-out opportunities for reporting parity."
          />
          <div className="grid gap-3 md:grid-cols-2">
            <TextField
              label="Pipeline filter (comma-separated names)"
              value={flags.pipeline_filter}
              onChange={(v) => set('pipeline_filter', v)}
              placeholder="Sales Pipeline, Refinance"
              description="Empty = all pipelines."
            />
            <TextField
              label="Stage filter (comma-separated names)"
              value={flags.stage_filter}
              onChange={(v) => set('stage_filter', v)}
              placeholder="New Lead, Qualified"
              description="Empty = all stages."
            />
          </div>
          <div className="rounded-md border border-border/60 bg-muted/20 p-3 space-y-1.5">
            <label className="text-xs font-medium">Assigned-user strategy</label>
            <Select value={flags.assigned_user_strategy} onValueChange={(v) => set('assigned_user_strategy', v as any)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="single">Single — use one target user (current default)</SelectItem>
                <SelectItem value="map_by_email">Map by email — match source assignee email → target user</SelectItem>
                <SelectItem value="omit">Omit — leave assignedTo empty in the target</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              <code>map_by_email</code> falls back to the configured single user when no email match is found.
            </p>
          </div>

          <div className="rounded-md border border-primary/30 bg-primary/5 p-3 space-y-2">
            <div className="text-xs font-semibold text-primary">Range / resume controls</div>
            <p className="text-[11px] text-muted-foreground">
              GHL <code>/opportunities/search</code> sorts newest-first by <code>date_added</code>. Use these to
              jump past an already-migrated head or a stuck cluster — applied <strong>once</strong> per fresh job.
            </p>
            <div className="grid gap-3 md:grid-cols-3">
              <TextField
                label="Skip first N opportunities"
                type="number"
                value={flags.skip_count}
                onChange={(v) => set('skip_count', v)}
                placeholder="e.g. 600"
                description="Drops the first N records the API returns before processing. One-time, persisted on the job."
              />
              <TextField
                label="Start after ISO timestamp"
                value={flags.start_after_iso}
                onChange={(v) => set('start_after_iso', v)}
                placeholder="2025-12-04T07:40:26.247Z"
                description="Seeds the cursor so GHL returns records older than this. Use a known-bad cluster's timestamp to skip past it."
              />
              <TextField
                label="Start after opp ID (optional)"
                value={flags.start_after_id}
                onChange={(v) => set('start_after_id', v)}
                placeholder="qYbgt9XzQT3sVCl8ppDf"
                description="Companion to ISO seed when GHL needs both. Leave blank if unsure."
              />
            </div>
          </div>
        </div>
      )}

      {domain === 'conversations' && (
        <div className="space-y-3">
          <div className="rounded-md border border-border/60 bg-muted/20 p-3 space-y-1.5">
            <label className="text-xs font-medium">Message direction</label>
            <Select value={flags.message_direction} onValueChange={(v) => set('message_direction', v as any)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All messages</SelectItem>
                <SelectItem value="inbound">Inbound only</SelectItem>
                <SelectItem value="outbound">Outbound only</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <TextField
              label="Channel filter (comma-separated)"
              value={flags.channel_filter}
              onChange={(v) => set('channel_filter', v)}
              placeholder="SMS, Email, IG"
              description="Empty = all channels."
            />
            <TextField
              label="Date range (last N days)"
              value={flags.date_range_days}
              onChange={(v) => set('date_range_days', v)}
              placeholder="90"
              description="Empty = no date limit."
              type="number"
            />
          </div>
          <Toggle
            checked={flags.skip_attachments}
            onChange={(v) => set('skip_attachments', v)}
            title="Skip attachments"
            description="Drop attachment payloads from the mirrored messages. Useful for fast catch-up syncs where only message bodies are needed."
          />
        </div>
      )}

      {domain === 'notes' && (
        <div className="space-y-3">
          <Toggle
            checked={flags.force_overwrite_existing}
            onChange={(v) => set('force_overwrite_existing', v)}
            title="Force overwrite existing notes"
            description="Re-create notes in the target even when a mapping exists. Required after a target wipe."
          />
          <TextField
            label="Minimum content length (characters)"
            value={flags.min_content_length}
            onChange={(v) => set('min_content_length', v)}
            placeholder="3"
            description="Drops empty/stub notes (e.g. GHL system markers) below the threshold. Empty = keep all."
            type="number"
          />
          <Toggle
            checked={flags.prefix_legacy_marker}
            onChange={(v) => set('prefix_legacy_marker', v)}
            title="Prefix migrated notes with [Migrated]"
            description="Prepends a marker to the note body so it's easy to identify and clean up in the target account later."
          />
        </div>
      )}

      {domain === 'conversations_replay' && (
        <div className="space-y-3">
          <div className="rounded-md border border-warning/40 bg-warning/5 p-3 text-[11px] leading-relaxed text-warning">
            <strong>Heads-up:</strong> This worker re-creates legacy conversations in the
            target account by calling <code>POST /conversations/</code> then replaying each
            message via <code>POST /conversations/messages</code> with a historical{' '}
            <code>date</code>. We omit <code>conversationProviderId</code> on outbound
            messages so GHL records-only and does <strong>not</strong> actually re-send
            SMS/email. Always run DRY RUN first against a single test contact.
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <TextField
              label="Channel filter (comma-separated)"
              value={flags.channel_filter}
              onChange={(v) => set('channel_filter', v)}
              placeholder="sms, email, whatsapp"
              description="Empty = all channels. Matches our internal channel_type values."
            />
            <TextField
              label="Date range (last N days)"
              value={flags.date_range_days}
              onChange={(v) => set('date_range_days', v)}
              placeholder="180"
              description="Only replay conversations whose last message is within N days. Empty = no limit."
              type="number"
            />
          </div>
          <TextField
            label="Max messages per conversation (0 = all)"
            value={flags.max_messages_per_conv}
            onChange={(v) => set('max_messages_per_conv', v)}
            placeholder="0"
            description="Hard cap on messages replayed per conversation shell. Useful for first runs."
            type="number"
          />
          <Toggle
            checked={flags.skip_activity}
            onChange={(v) => set('skip_activity', v)}
            title="Skip system / activity messages"
            description="Recommended ON. GHL activity events (call recordings, automation logs) cannot be re-created via the messages API."
          />
          <Toggle
            checked={flags.skip_attachments}
            onChange={(v) => set('skip_attachments', v)}
            title="Skip attachments"
            description="Drop attachment URLs from the replayed messages. Faster and avoids stale-URL fetch failures."
          />
          <Toggle
            checked={flags.prefix_legacy_marker}
            onChange={(v) => set('prefix_legacy_marker', v)}
            title="Prefix replayed messages with [Migrated]"
            description="Prepends a marker to each message body so the target inbox shows what came from the legacy account."
          />
          <Toggle
            checked={flags.force_overwrite_existing}
            onChange={(v) => set('force_overwrite_existing', v)}
            title="Force overwrite existing replays"
            description="Re-create the conversation shell + messages even if a target mapping already exists. Required after a target wipe."
          />
        </div>
      )}

      {domain === 'calendars' && (
        <div className="space-y-3">
          <div className="rounded-md border border-warning/40 bg-warning/5 p-3 text-[11px] leading-relaxed">
            <strong>Heads-up:</strong> GHL requires every calendar to have at least one
            team member. If users have not been migrated yet (no <code>user</code> mappings
            in <code>ghl_id_mapping</code>), provide a <strong>default fallback userId</strong>{' '}
            from the <em>target</em> account below. <strong>PERSONAL</strong> calendars are
            auto-trimmed to one team member.
          </div>
          <TextField
            label="Default fallback userId (target account)"
            value={flags.default_user_id}
            onChange={(v) => set('default_user_id', v)}
            placeholder="e.g. 0SXXXXXXXXXXXXXXXXXX"
            description="Used only when no team members can be mapped. Must be a valid userId in the target GHL account (Settings → My Staff → user → Profile URL)."
          />
        </div>
      )}

      {domain === 'bookings' && (
        <div className="space-y-3">
          <div className="rounded-md border border-warning/40 bg-warning/5 p-3 text-[11px] leading-relaxed">
            <strong>Heads-up:</strong> Bookings are migrated per mapped calendar.
            Default <code>all</code> mode sweeps 5 years back → 2 years forward.
            Use <code>future_only</code> for ongoing catch-up syncs and{' '}
            <code>window</code> for surgical re-runs of a specific date range.
            Contact mappings must already exist (run contacts worker first).
          </div>
          <div className="rounded-md border border-border/60 bg-muted/20 p-3 space-y-1.5">
            <label className="text-xs font-medium">Time-window mode</label>
            <Select value={flags.bookings_mode} onValueChange={(v) => set('bookings_mode', v as BookingsMode)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All — 5 years back → 2 years forward (recommended for first migration)</SelectItem>
                <SelectItem value="future_only">Future only — last N days → 1 year forward</SelectItem>
                <SelectItem value="window">Custom window — explicit start/end dates</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {flags.bookings_mode === 'future_only' && (
            <TextField
              label="Lookback days"
              type="number"
              value={flags.bookings_lookback_days}
              onChange={(v) => set('bookings_lookback_days', v)}
              placeholder="7"
              description="How many days into the past to include (captures recently-completed bookings)."
            />
          )}
          {flags.bookings_mode === 'window' && (
            <div className="grid gap-3 md:grid-cols-2">
              <TextField
                label="Start date (YYYY-MM-DD)"
                value={flags.bookings_start_date}
                onChange={(v) => set('bookings_start_date', v)}
                placeholder="2024-01-01"
              />
              <TextField
                label="End date (YYYY-MM-DD)"
                value={flags.bookings_end_date}
                onChange={(v) => set('bookings_end_date', v)}
                placeholder="2027-12-31"
              />
            </div>
          )}
          <TextField
            label="Default assigned userId (target account)"
            value={flags.default_user_id}
            onChange={(v) => set('default_user_id', v)}
            placeholder="e.g. 0SXXXXXXXXXXXXXXXXXX"
            description="Required by GHL when source event has no mappable assignedUserId. Use the active user in the new GHL account (Settings → My Staff → user → Profile URL)."
          />
          <Toggle
            checked={flags.bookings_notify_attendees}
            onChange={(v) => set('bookings_notify_attendees', v)}
            title="Notify attendees on creation"
            description="Off by default — prevents GHL from re-emailing contacts about historical bookings."
          />
        </div>
      )}
    </div>
  );
};

