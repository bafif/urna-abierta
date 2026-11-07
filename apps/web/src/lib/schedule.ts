/** A poll watcher's own times: a shift inside the day, when to arrive and where to meet. Each one may be missing. */
export interface Schedule {
  from?: string;
  to?: string;
  arrive?: string;
  meet?: string;
}

/** «de 08:00 a 13:00 · llega 07:30 · Puerta principal», in the words of the screen's language. */
export function scheduleText(schedule: Schedule | null | undefined, words: { from: string; arrive: string; meet: string }): string {
  if (!schedule) return '';
  const parts = [
    schedule.from && schedule.to ? words.from.replace('{from}', schedule.from).replace('{to}', schedule.to) : '',
    schedule.arrive ? words.arrive.replace('{time}', schedule.arrive) : '',
    schedule.meet ? words.meet.replace('{place}', schedule.meet) : '',
  ];
  return parts.filter(Boolean).join(' · ');
}

/** The time of day where the election is, as «14:05», so that the hours of a day compare as text. */
export function timeIn(timeZone: string | undefined, now = new Date()): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
}
