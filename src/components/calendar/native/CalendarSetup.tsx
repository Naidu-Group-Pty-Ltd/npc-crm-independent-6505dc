/**
 * Setting calendars up, on a deployment that runs its own.
 *
 * A fresh deployment of the CRM-independent line has no calendars. The page
 * could list them and book into them, and nothing anywhere could make one, so
 * every booking form opened on an empty list. This panel is that writer:
 * a calendar's name and zone, who is on it, and the weekly hours it can be
 * booked in. Every rule it shows is the server's (`calendarBooking.pure.ts`),
 * and every refusal is shown in the server's words.
 *
 * It is found by `Calendar.tsx` through `import.meta.glob`, which answers an
 * empty record where this file is missing, so the prime, which reads a
 * vendor's calendars and has nothing to set up, builds and draws without it.
 * That keeps the page itself identical on both lines, which is what stops a
 * prime cascade from reverting it.
 */
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarCog, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { FALLBACK_CALENDAR_COLOR } from "@/lib/calendarColors";
import { cn } from "@/lib/utils";
import {
  AUSTRALIAN_TIME_ZONES,
  CALENDAR_TYPES,
  CALENDAR_TYPE_LABELS,
  WEEKDAY_DISPLAY_ORDER,
  WEEKDAY_NAMES,
  businessHoursPreset,
  newDraft,
  prepareHours,
  summariseHours,
  toDrafts,
  type CalendarType,
  type HoursDraft,
} from "@/lib/crm/calendarSetup.pure";
import {
  createCalendar,
  loadCalendarSettings,
  setCalendarHours,
  setCalendarTeam,
  updateCalendar,
  type CalendarMember,
  type CalendarSetting,
  type StaffOption,
} from "@/lib/crm/calendarSetup";

const SETTINGS_KEY = ["crm-calendar-settings"] as const;
const NEW = "new";
const SLOT_CHOICES = [10, 15, 20, 30, 45, 60, 90, 120];

type Section = "details" | "team" | "hours";

type DetailsDraft = {
  name: string;
  description: string;
  calendarType: CalendarType;
  timezone: string;
  eventColor: string | null;
  isActive: boolean;
};

const EMPTY_DETAILS: DetailsDraft = {
  name: "",
  description: "",
  calendarType: "event",
  timezone: "Australia/Sydney",
  eventColor: null,
  isActive: true,
};

function detailsOf(calendar: CalendarSetting): DetailsDraft {
  return {
    name: calendar.name,
    description: calendar.description ?? "",
    calendarType: calendar.calendarType,
    timezone: calendar.timezone,
    eventColor: calendar.eventColor ?? null,
    isActive: calendar.isActive,
  };
}

function teamOf(calendar: CalendarSetting): Map<string, CalendarMember["role"]> {
  return new Map(calendar.members.map((m) => [m.userId.toLowerCase(), m.role]));
}

export interface CalendarSetupProps {
  /** Called after any save, so the page re-reads its calendars. */
  onChanged: () => void;
}

export default function CalendarSetup({ onChanged }: CalendarSetupProps) {
  const [open, setOpen] = useState(false);
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [openOn, setOpenOn] = useState<Section>("details");
  const queryClient = useQueryClient();

  const settings = useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: loadCalendarSettings,
    enabled: open,
    staleTime: 0,
  });

  const calendars = useMemo(() => settings.data?.calendars ?? [], [settings.data]);
  const staff = useMemo(() => settings.data?.staff ?? [], [settings.data]);

  // Until somebody picks one, the first calendar is shown, or the new-calendar
  // form where there are none: a fresh deployment opens straight onto making
  // its first calendar.
  const selectedId =
    chosenId ?? calendars[0]?.id ?? (settings.isSuccess ? NEW : null);
  const selected = calendars.find((c) => c.id === selectedId) ?? null;

  const choose = (id: string, section: Section = "details") => {
    setChosenId(id);
    setOpenOn(section);
  };

  const afterSave = async () => {
    await queryClient.invalidateQueries({ queryKey: SETTINGS_KEY });
    onChanged();
  };

  const isNew = selectedId === NEW;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setChosenId(null);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <CalendarCog className="h-4 w-4" aria-hidden="true" />
          Manage calendars
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Manage calendars</DialogTitle>
          <DialogDescription>
            Name each calendar, choose who is on it, and set the hours it can be booked in.
            A calendar with no hours can still be booked at any time.
          </DialogDescription>
        </DialogHeader>

        {settings.isLoading ? (
          <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Reading calendars…
          </div>
        ) : settings.isError ? (
          <div className="space-y-3 py-6">
            <p role="alert" className="text-sm text-destructive">
              {settings.error instanceof Error
                ? settings.error.message
                : "Could not read the calendar settings."}
            </p>
            <Button variant="outline" size="sm" onClick={() => settings.refetch()}>
              Try again
            </Button>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-[14rem_minmax(0,1fr)]">
            <nav aria-label="Calendars" className="space-y-2">
              <Button
                variant={isNew ? "default" : "outline"}
                size="sm"
                className="w-full justify-start gap-2"
                onClick={() => choose(NEW)}
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                New calendar
              </Button>
              <ul className="space-y-1">
                {calendars.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      aria-current={c.id === selectedId ? "true" : undefined}
                      onClick={() => choose(c.id)}
                      className={cn(
                        "w-full rounded-lg border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        c.id === selectedId
                          ? "border-primary/50 bg-primary/10"
                          : "border-transparent hover:border-border hover:bg-muted/50",
                      )}
                    >
                      <span className="flex items-center gap-2">
                        <span
                          aria-hidden="true"
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: c.eventColor ?? FALLBACK_CALENDAR_COLOR }}
                        />
                        <span className="truncate text-sm font-medium text-foreground">{c.name}</span>
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {c.isActive ? summariseHours(c.availability) : "Switched off"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </nav>

            {selectedId === null || (!isNew && !selected) ? (
              <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Reading calendars…
              </div>
            ) : (
              // Keyed by the calendar: each one opens on the server's copy, and a
              // refetch after a save never overwrites an edit already under way.
              <CalendarEditor
                key={selectedId}
                calendar={isNew ? null : selected}
                staff={staff}
                initialSection={openOn}
                onSaved={afterSave}
                onCreated={(id) => choose(id, "hours")}
              />
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

interface CalendarEditorProps {
  /** Null while a new calendar is being made. */
  calendar: CalendarSetting | null;
  staff: readonly StaffOption[];
  initialSection: Section;
  onSaved: () => Promise<void>;
  onCreated: (calendarId: string) => void;
}

function CalendarEditor({ calendar, staff, initialSection, onSaved, onCreated }: CalendarEditorProps) {
  const isNew = calendar === null;
  const [section, setSection] = useState<Section>(isNew ? "details" : initialSection);
  const [details, setDetails] = useState<DetailsDraft>(() =>
    calendar ? detailsOf(calendar) : EMPTY_DETAILS,
  );
  const [team, setTeam] = useState<Map<string, CalendarMember["role"]>>(() =>
    calendar ? teamOf(calendar) : new Map(),
  );
  const [hours, setHours] = useState<HoursDraft[]>(() =>
    calendar ? toDrafts(calendar.availability) : [],
  );
  const [saving, setSaving] = useState<Section | null>(null);
  const [refusal, setRefusal] = useState<{ section: Section; message: string } | null>(null);
  const [staffFilter, setStaffFilter] = useState("");

  const fail = (where: Section, err: unknown) => {
    setRefusal({
      section: where,
      message: err instanceof Error ? err.message : "That could not be saved. Please try again.",
    });
  };

  const saveDetails = async () => {
    setSaving("details");
    setRefusal(null);
    const payload = {
      name: details.name,
      description: details.description.trim() === "" ? null : details.description,
      calendarType: details.calendarType,
      timezone: details.timezone,
      eventColor: details.eventColor,
    };
    try {
      if (calendar === null) {
        const { calendarId, teamSaved } = await createCalendar(payload);
        await onSaved();
        toast.success(`${details.name.trim()} created. Set its hours so it can be booked.`);
        if (!teamSaved) {
          toast.warning("You were not added to its team. Add yourself on the Team tab.");
        }
        onCreated(calendarId);
        return;
      }
      await updateCalendar(calendar.id, { ...payload, isActive: details.isActive });
      await onSaved();
      toast.success("Calendar saved.");
    } catch (err) {
      fail("details", err);
    } finally {
      setSaving(null);
    }
  };

  const saveTeam = async () => {
    if (calendar === null) return;
    setSaving("team");
    setRefusal(null);
    try {
      await setCalendarTeam(
        calendar.id,
        [...team.entries()].map(([userId, role]) => ({ userId, role })),
      );
      await onSaved();
      toast.success("Team saved.");
    } catch (err) {
      fail("team", err);
    } finally {
      setSaving(null);
    }
  };

  const saveHours = async () => {
    if (calendar === null) return;
    const prepared = prepareHours(hours);
    if (!prepared.ok) {
      setRefusal({ section: "hours", message: prepared.message });
      return;
    }
    setSaving("hours");
    setRefusal(null);
    try {
      await setCalendarHours(calendar.id, prepared.windows);
      await onSaved();
      toast.success(prepared.windows.length === 0 ? "Hours cleared." : "Hours saved.");
    } catch (err) {
      fail("hours", err);
    } finally {
      setSaving(null);
    }
  };

  const filteredStaff = useMemo(() => {
    const q = staffFilter.trim().toLowerCase();
    if (!q) return staff;
    return staff.filter(
      (s) => s.name.toLowerCase().includes(q) || (s.email ?? "").toLowerCase().includes(q),
    );
  }, [staff, staffFilter]);

  const zones = useMemo(() => {
    const known = AUSTRALIAN_TIME_ZONES.some((z) => z.value === details.timezone);
    return known
      ? AUSTRALIAN_TIME_ZONES
      : [...AUSTRALIAN_TIME_ZONES, { value: details.timezone, label: details.timezone }];
  }, [details.timezone]);

  const refusalFor = (where: Section) =>
    refusal?.section === where ? (
      <p role="alert" className="text-sm text-destructive">
        {refusal.message}
      </p>
    ) : null;

  return (
    <Tabs value={isNew ? "details" : section} onValueChange={(v) => setSection(v as Section)}>
      <TabsList className="w-full sm:w-auto">
        <TabsTrigger value="details">Details</TabsTrigger>
        <TabsTrigger value="team" disabled={isNew}>
          Team{!isNew && team.size > 0 ? ` (${team.size})` : ""}
        </TabsTrigger>
        <TabsTrigger value="hours" disabled={isNew}>
          Hours
        </TabsTrigger>
      </TabsList>

      <TabsContent value="details" className="space-y-4 pt-2">
        <div className="space-y-1.5">
          <Label htmlFor="calendar-name">Name</Label>
          <Input
            id="calendar-name"
            value={details.name}
            maxLength={200}
            placeholder="e.g. Property consultations"
            onChange={(e) => setDetails({ ...details, name: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="calendar-description">Description</Label>
          <Textarea
            id="calendar-description"
            value={details.description}
            maxLength={2000}
            rows={2}
            onChange={(e) => setDetails({ ...details, description: e.target.value })}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="calendar-zone">Time zone</Label>
            <Select
              value={details.timezone}
              onValueChange={(v) => setDetails({ ...details, timezone: v })}
            >
              <SelectTrigger id="calendar-zone">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {zones.map((z) => (
                  <SelectItem key={z.value} value={z.value}>
                    {z.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              The hours below are read in this zone.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="calendar-type">Type</Label>
            <Select
              value={details.calendarType}
              onValueChange={(v) => setDetails({ ...details, calendarType: v as CalendarType })}
            >
              <SelectTrigger id="calendar-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CALENDAR_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {CALENDAR_TYPE_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Label htmlFor="calendar-colour">Colour</Label>
          <input
            id="calendar-colour"
            type="color"
            value={details.eventColor ?? FALLBACK_CALENDAR_COLOR}
            onChange={(e) => setDetails({ ...details, eventColor: e.target.value })}
            className="h-9 w-12 cursor-pointer rounded-md border border-input bg-background p-1"
          />
          {details.eventColor !== null && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDetails({ ...details, eventColor: null })}
            >
              Use the default colour
            </Button>
          )}
        </div>
        {!isNew && (
          <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-3">
            <div>
              <Label htmlFor="calendar-active">Taking bookings</Label>
              <p className="text-xs text-muted-foreground">
                Switched off, it leaves the booking forms and keeps its appointments.
              </p>
            </div>
            <Switch
              id="calendar-active"
              checked={details.isActive}
              onCheckedChange={(v) => setDetails({ ...details, isActive: v })}
            />
          </div>
        )}
        {refusalFor("details")}
        <div className="flex justify-end">
          <Button
            onClick={saveDetails}
            disabled={saving !== null || details.name.trim() === ""}
          >
            {saving === "details" && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            )}
            {isNew ? "Create calendar" : "Save details"}
          </Button>
        </div>
      </TabsContent>

      <TabsContent value="team" className="space-y-3 pt-2">
        <p className="text-sm text-muted-foreground">
          Choose who this calendar books for. Mark whoever looks after it as its owner.
        </p>
        {staff.length > 8 && (
          <Input
            aria-label="Find staff"
            placeholder="Find staff…"
            value={staffFilter}
            onChange={(e) => setStaffFilter(e.target.value)}
          />
        )}
        {staff.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active staff accounts to add.</p>
        ) : (
          <ul className="max-h-72 space-y-1 overflow-y-auto pr-1">
            {filteredStaff.map((person) => {
              const id = person.id.toLowerCase();
              const role = team.get(id);
              const checkboxId = `team-${id}`;
              return (
                <li
                  key={id}
                  className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 hover:bg-muted/40"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <Checkbox
                      id={checkboxId}
                      checked={role !== undefined}
                      onCheckedChange={(checked) => {
                        const next = new Map(team);
                        if (checked) next.set(id, role ?? "member");
                        else next.delete(id);
                        setTeam(next);
                      }}
                    />
                    <Label htmlFor={checkboxId} className="min-w-0 cursor-pointer font-normal">
                      <span className="block truncate text-sm text-foreground">{person.name}</span>
                      {person.email && (
                        <span className="block truncate text-xs text-muted-foreground">
                          {person.email}
                        </span>
                      )}
                    </Label>
                  </span>
                  {role !== undefined && (
                    <Select
                      value={role}
                      onValueChange={(v) => {
                        const next = new Map(team);
                        next.set(id, v as CalendarMember["role"]);
                        setTeam(next);
                      }}
                    >
                      <SelectTrigger
                        className="h-8 w-28"
                        aria-label={`${person.name}'s role`}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="owner">Owner</SelectItem>
                        <SelectItem value="member">Member</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {refusalFor("team")}
        <div className="flex justify-end">
          <Button onClick={saveTeam} disabled={saving !== null}>
            {saving === "team" && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            )}
            Save team
          </Button>
        </div>
      </TabsContent>

      <TabsContent value="hours" className="space-y-3 pt-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            Bookings must fit inside these hours, in {(calendar?.timezone ?? details.timezone).replace("_", " ")} time,
            unless the person booking switches on “Override availability”.
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setHours(businessHoursPreset())}>
              Weekdays 9 to 5
            </Button>
            {hours.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setHours([])}>
                Clear all
              </Button>
            )}
          </div>
        </div>
        <ul className="divide-y divide-border rounded-lg border border-border">
          {WEEKDAY_DISPLAY_ORDER.map((weekday) => {
            const dayWindows = hours.filter((h) => h.weekday === weekday);
            const dayName = WEEKDAY_NAMES[weekday];
            return (
              <li
                key={weekday}
                className="flex flex-col gap-2 p-3 sm:flex-row sm:items-start"
              >
                <span className="w-24 shrink-0 pt-1.5 text-sm font-medium text-foreground">
                  {dayName}
                </span>
                <div className="flex-1 space-y-2">
                  {dayWindows.length === 0 && (
                    <p className="pt-1.5 text-sm text-muted-foreground">Closed</p>
                  )}
                  {dayWindows.map((w) => {
                    const update = (patch: Partial<HoursDraft>) =>
                      setHours(hours.map((h) => (h.key === w.key ? { ...h, ...patch } : h)));
                    const slotChoices = SLOT_CHOICES.includes(w.slotMinutes)
                      ? SLOT_CHOICES
                      : [...SLOT_CHOICES, w.slotMinutes].sort((a, b) => a - b);
                    return (
                      <div key={w.key} className="flex flex-wrap items-center gap-2">
                        <Input
                          type="time"
                          aria-label={`${dayName} opens`}
                          value={w.start}
                          onChange={(e) => update({ start: e.target.value })}
                          className="h-9 w-32"
                        />
                        <span className="text-sm text-muted-foreground">to</span>
                        <Input
                          type="time"
                          aria-label={`${dayName} closes`}
                          value={w.end}
                          onChange={(e) => update({ end: e.target.value })}
                          className="h-9 w-32"
                        />
                        <Select
                          value={String(w.slotMinutes)}
                          onValueChange={(v) => update({ slotMinutes: Number(v) })}
                        >
                          <SelectTrigger
                            className="h-9 w-36"
                            aria-label={`${dayName} appointment length`}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {slotChoices.map((m) => (
                              <SelectItem key={m} value={String(m)}>
                                {m}-minute slots
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Remove these ${dayName} hours`}
                          onClick={() => setHours(hours.filter((h) => h.key !== w.key))}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" aria-hidden="true" />
                        </Button>
                      </div>
                    );
                  })}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 gap-1 px-2 text-primary"
                    onClick={() =>
                      setHours([...hours, newDraft(weekday, dayWindows[dayWindows.length - 1])])
                    }
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    {dayWindows.length === 0 ? `Open on ${dayName}` : "Add more hours"}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
        <p className="text-xs text-muted-foreground">
          A closing time of 00:00 means the hours run to midnight.
        </p>
        {refusalFor("hours")}
        <div className="flex items-center justify-end gap-3">
          {calendar && !calendar.isActive && (
            <Badge variant="outline">Switched off</Badge>
          )}
          <Button onClick={saveHours} disabled={saving !== null}>
            {saving === "hours" && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            )}
            Save hours
          </Button>
        </div>
      </TabsContent>
    </Tabs>
  );
}
