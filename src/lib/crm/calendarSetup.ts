/**
 * The calendar setup actions on `crm-calendar`, typed for the setup panel.
 *
 * A fresh deployment of this line has no calendars, and before these actions
 * nothing in the product could make one: the page listed calendars and
 * booked into them, and every list was empty. Each call here either returns
 * what the server stored or throws the server's own sentence, so the panel
 * never reports a save the server refused.
 */
import { invokeSecureFunction } from "@/lib/secureInvoke";
import { crmFunction } from "@/lib/crm/crmProvider";
import type { CalendarType, HoursWindow } from "@/lib/crm/calendarSetup.pure";

export type CalendarMember = { readonly userId: string; readonly role: "owner" | "member" };

export type CalendarSetting = {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly calendarType: CalendarType;
  readonly isActive: boolean;
  readonly timezone: string;
  readonly eventColor?: string;
  readonly members: readonly CalendarMember[];
  readonly availability: readonly HoursWindow[];
};

export type StaffOption = { readonly id: string; readonly name: string; readonly email: string | null };

export type CalendarSettings = {
  readonly calendars: readonly CalendarSetting[];
  readonly staff: readonly StaffOption[];
};

export type CalendarDetails = {
  readonly name?: string;
  readonly description?: string | null;
  readonly calendarType?: CalendarType;
  readonly eventColor?: string | null;
  readonly timezone?: string;
  readonly isActive?: boolean;
};

async function call<T>(action: string, body: Record<string, unknown>, fallback: string): Promise<T> {
  const { data, error } = await invokeSecureFunction<T>(crmFunction("calendar"), { action, ...body });
  if (error) throw new Error(error.message || fallback);
  if (data === null || data === undefined) throw new Error(fallback);
  return data;
}

export function loadCalendarSettings(): Promise<CalendarSettings> {
  return call<CalendarSettings>(
    "listCalendarSettings",
    {},
    "Could not read the calendar settings. Please try again.",
  );
}

export async function createCalendar(
  details: CalendarDetails,
): Promise<{ calendarId: string; teamSaved: boolean }> {
  const data = await call<{ calendar: { id: string }; teamSaved: boolean }>(
    "createCalendar",
    { ...details },
    "The calendar could not be created.",
  );
  return { calendarId: data.calendar.id, teamSaved: data.teamSaved };
}

export async function updateCalendar(calendarId: string, details: CalendarDetails): Promise<void> {
  await call("updateCalendar", { calendarId, ...details }, "The calendar could not be saved.");
}

export async function setCalendarTeam(
  calendarId: string,
  members: readonly CalendarMember[],
): Promise<void> {
  await call("setCalendarMembers", { calendarId, members }, "The team could not be saved.");
}

export async function setCalendarHours(
  calendarId: string,
  availability: readonly HoursWindow[],
): Promise<void> {
  await call("setAvailability", { calendarId, availability }, "The hours could not be saved.");
}
