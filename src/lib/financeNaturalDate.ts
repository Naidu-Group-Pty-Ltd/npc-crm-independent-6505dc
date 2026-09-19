/**
 * Client-side natural-language date parser (mirrors the edge-function parser).
 * Used to give live preview as the partner types into the Smart Snooze input.
 */
export function parseNaturalDate(input: string): Date | null {
  if (!input) return null;
  const s = input.trim().toLowerCase();
  const now = new Date();
  const result = new Date(now);

  const iso = Date.parse(input);
  if (!Number.isNaN(iso)) return new Date(iso);

  if (s === 'today') { result.setHours(17, 0, 0, 0); return result; }
  if (s === 'tomorrow') { result.setDate(result.getDate() + 1); result.setHours(9, 0, 0, 0); return result; }
  if (s === 'next week') { result.setDate(result.getDate() + 7); result.setHours(9, 0, 0, 0); return result; }

  const inMatch = s.match(/^in\s+(\d+)\s*(minute|min|hour|hr|day|week)s?$/);
  if (inMatch) {
    const n = parseInt(inMatch[1], 10);
    const unit = inMatch[2];
    if (unit.startsWith('min')) result.setMinutes(result.getMinutes() + n);
    else if (unit.startsWith('hr') || unit.startsWith('hour')) result.setHours(result.getHours() + n);
    else if (unit.startsWith('day')) result.setDate(result.getDate() + n);
    else if (unit.startsWith('week')) result.setDate(result.getDate() + n * 7);
    return result;
  }

  const wkRegex = /^(next\s+)?(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day)?(?:\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?$/;
  const wk = s.match(wkRegex);
  if (wk) {
    const isNext = !!wk[1];
    const map: Record<string, number> = {
      sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6,
    };
    const targetDay = map[wk[2]];
    let diff = (targetDay - result.getDay() + 7) % 7;
    if (diff === 0) diff = 7;
    if (isNext) diff = diff === 7 ? 7 : diff + 7;
    result.setDate(result.getDate() + diff);
    let hour = wk[3] ? parseInt(wk[3], 10) : 9;
    const min = wk[4] ? parseInt(wk[4], 10) : 0;
    const ampm = wk[5];
    if (ampm === 'pm' && hour < 12) hour += 12;
    if (ampm === 'am' && hour === 12) hour = 0;
    result.setHours(hour, min, 0, 0);
    return result;
  }

  const timeMatch = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (timeMatch) {
    let hour = parseInt(timeMatch[1], 10);
    const min = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
    const ampm = timeMatch[3];
    if (ampm === 'pm' && hour < 12) hour += 12;
    if (ampm === 'am' && hour === 12) hour = 0;
    result.setHours(hour, min, 0, 0);
    if (result <= now) result.setDate(result.getDate() + 1);
    return result;
  }

  return null;
}
