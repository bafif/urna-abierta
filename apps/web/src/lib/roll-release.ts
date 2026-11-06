import { DEFAULT_TIME_ZONE, isTimeZone } from '@urna-abierta/domain';

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
  /** Where the election happens: its days start there, wherever the phone is. */
  timeZone: string | undefined;
  /** How far ahead the server's clock is: a phone with the wrong date does not let go of the roll on election day. */
  clockOffset: number;
}

/** The moment a day starts in a time zone, such as 2027-04-06 at midnight in Argentina. */
export function startOfDay(day: string, timeZone: string): number {
  const zone = isTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE;
  const format = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
  // How far the clock of the zone is ahead of UTC at a moment.
  const ahead = (at: number) => {
    const part = (type: string) => Number(format.formatToParts(at).find((item) => item.type === type)!.value);
    return Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second')) - at;
  };
  const wall = Date.parse(`${day}T00:00:00Z`);
  // Twice: on a day the clocks change, the difference at midnight is not the one at midnight in UTC.
  return wall - ahead(wall - ahead(wall));
}

/**
 * Whether the roll can leave the phone. With the server at hand, once it no longer gives this table to this person: an
 * election still being counted keeps it, however late. Without the server, by the calendar where the election happens
 * and by the server's clock.
 */
export function rollCanGo({ tableId, reached, assigned, lastDay, hoursKept, timeZone, clockOffset }: RollOnPhone, now = Date.now()): boolean {
  if (reached) return assigned !== tableId;
  if (!lastDay) return false;
  return now + clockOffset - startOfDay(lastDay, timeZone ?? DEFAULT_TIME_ZONE) > (CLOSE_ASSUMED_HOURS + (hoursKept ?? HOURS_KEPT_IF_UNKNOWN)) * 3_600_000;
}
