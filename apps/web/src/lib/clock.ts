/** Past this, the phone's clock is far enough off to say so. */
export const CLOCK_WARNING_MS = 3 * 3_600_000;
/** Whoever fixes the clock by hand sets it to the minute, give or take. */
const FIXED_WITHIN_MS = 10 * 60_000;

/**
 * How far ahead the server's clock is after the phone's own clock jumped: it moved this much more than the time that
 * passed. A jump of about what it was off is someone fixing the clock, as the notice asks, maybe with no signal: then
 * nothing is left of the difference, and the day stays right. Any other jump, or a small difference, stays as it was
 * until the next sync measures it again. A phone asleep also seems to jump, since that time does not count: only one
 * of the very size of the difference is taken, and the next sync puts it right anyway.
 */
export function offsetAfterJump(offset: number, jump: number): number {
  return Math.abs(offset) > CLOCK_WARNING_MS && Math.abs(jump - offset) < FIXED_WITHIN_MS ? offset - jump : offset;
}
