/** Where an election happens unless it says otherwise. */
export const DEFAULT_TIME_ZONE = 'America/Argentina/Buenos_Aires';

export function isTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || !value) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** The date in a time zone, as 2027-04-06: at ten at night in Argentina it is still today there, not tomorrow. */
export function dayIn(timeZone: string, at: Date = new Date()): string {
  const zone = isTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE;
  const parts = new Intl.DateTimeFormat('en', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
  const part = (type: string) => parts.find((item) => item.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
