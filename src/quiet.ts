/** Parse "HH:MM" into minutes since midnight. */
function minutes(hhmm: string): number | undefined {
  const m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(hhmm);
  if (!m) return undefined;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : undefined;
}

/** Is `date` inside a range like "22:00-08:00" (may wrap past midnight)? Empty or invalid means never. */
export function inQuietHours(range: string, date = new Date()): boolean {
  const [a, b] = range.split('-');
  if (a === undefined || b === undefined) return false;
  const start = minutes(a);
  const end = minutes(b);
  if (start === undefined || end === undefined || start === end) return false;
  const now = date.getHours() * 60 + date.getMinutes();
  return start < end ? now >= start && now < end : now >= start || now < end;
}
