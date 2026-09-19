export type DigestPeriod = "24h" | "weekly" | "biweekly" | "monthly" | "quarterly" | "annual";

const utcDay = (date:Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
const addDays = (date:Date, days:number) => new Date(date.getTime() + days * 86_400_000);

export function canonicalPeriodWindow(period:DigestPeriod, reference = new Date()) {
  const day = utcDay(reference);
  let start:Date;
  let end:Date;
  if (period === '24h') {
    start = day; end = addDays(start, 1);
  } else if (period === 'weekly') {
    const sinceMonday = (day.getUTCDay() + 6) % 7;
    start = addDays(day, -sinceMonday); end = addDays(start, 7);
  } else if (period === 'biweekly') {
    const anchor = Date.UTC(1970, 0, 5);
    const block = Math.floor((day.getTime() - anchor) / (14 * 86_400_000));
    start = new Date(anchor + block * 14 * 86_400_000); end = addDays(start, 14);
  } else if (period === 'monthly') {
    start = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), 1));
    end = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + 1, 1));
  } else if (period === 'quarterly') {
    const quarterMonth = Math.floor(day.getUTCMonth() / 3) * 3;
    start = new Date(Date.UTC(day.getUTCFullYear(), quarterMonth, 1));
    end = new Date(Date.UTC(day.getUTCFullYear(), quarterMonth + 3, 1));
  } else {
    start = new Date(Date.UTC(day.getUTCFullYear(), 0, 1));
    end = new Date(Date.UTC(day.getUTCFullYear() + 1, 0, 1));
  }
  return { start, end, key:`${period}:${start.toISOString()}` };
}
