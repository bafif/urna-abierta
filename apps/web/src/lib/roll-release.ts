/**
 * A phone that never heard the election closed takes it as closed once the night after the last day is over,
 * counting included, and keeps the roll only the hours the security profile allows after that.
 */
export const CLOSE_ASSUMED_HOURS = 30;
export const HOURS_KEPT_IF_UNKNOWN = 12;

export interface RollOnPhone {
  /** The table whose roll the phone has. */
  tableId: string;
  /** The server answered just now: then only what it says counts, and the calendar does not. */
  reached: boolean;
  /** The table the server gives this person now. None once the election closed. */
  assigned: string | undefined;
  lastDay: string | undefined;
  hoursKept: number | undefined;
}

/**
 * Whether the roll can leave the phone. With the server at hand, once it no longer gives this table to this person: an
 * election still being counted keeps it, however late. Without the server, by the calendar.
 */
export function rollCanGo({ tableId, reached, assigned, lastDay, hoursKept }: RollOnPhone, now = Date.now()): boolean {
  if (reached) return assigned !== tableId;
  if (!lastDay) return false;
  return now - Date.parse(`${lastDay}T00:00:00`) > (CLOSE_ASSUMED_HOURS + (hoursKept ?? HOURS_KEPT_IF_UNKNOWN)) * 3_600_000;
}
