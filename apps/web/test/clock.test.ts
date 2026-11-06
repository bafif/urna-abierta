import { describe, expect, it } from 'vitest';
import { offsetAfterJump } from '../src/lib/clock.ts';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe('the difference with the server when the phone clock jumps', () => {
  it('someone who fixes a clock a day behind, with no signal, is left with no difference', () => {
    expect(offsetAfterJump(DAY, DAY)).toBe(0);
    // Fixed to the minute, give or take.
    expect(offsetAfterJump(DAY, DAY - 3 * 60_000)).toBe(3 * 60_000);
    // A clock ahead goes back.
    expect(offsetAfterJump(-5 * HOUR, -5 * HOUR + 60_000)).toBe(-60_000);
  });

  it('any other jump, or a small difference, stays until the next sync', () => {
    expect(offsetAfterJump(DAY, HOUR)).toBe(DAY);
    expect(offsetAfterJump(DAY, -DAY)).toBe(DAY);
    expect(offsetAfterJump(-5 * HOUR, 5 * HOUR)).toBe(-5 * HOUR);
    expect(offsetAfterJump(2 * HOUR, 2 * HOUR)).toBe(2 * HOUR);
    expect(offsetAfterJump(0, DAY)).toBe(0);
  });
});
