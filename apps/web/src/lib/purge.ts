/** How long the names are kept after the last day, in days: a week, a month (recommended for every level) or three. */
export const KEEP_DAYS = { week: 7, month: 30, quarter: 90 } as const;
export type KeepChoice = keyof typeof KEEP_DAYS | 'other';

/** A day plus some days, as «2027-05-08», counted at midday so that no time zone moves it. */
export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T12:00:00`);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Days from today to that day: negative once it passed. */
export function daysUntil(day: string, today: string): number {
  return Math.round((Date.parse(`${day}T12:00:00`) - Date.parse(`${today}T12:00:00`)) / 86_400_000);
}

/**
 * Whether the start screen warns about erasing the names: from a week before the day the party chose, and after it,
 * until they are erased. The app never erases by itself: there may be a challenge still open.
 */
export function purgeNotice(election: { status: string; purge_by?: string | null }, today: string): { left: number } | null {
  if (!election.purge_by || election.status === 'purgada') return null;
  const left = daysUntil(election.purge_by, today);
  return left <= 7 ? { left } : null;
}
