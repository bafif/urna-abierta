import { describe, expect, it } from 'vitest';
import { rollCanGo } from '../src/lib/roll-release.ts';

const lastDay = '2027-04-06';
const at = (moment: string) => Date.parse(moment);

describe('when the roll leaves the phone', () => {
  it('with the server at hand, only once the server no longer gives that table, however late it is', () => {
    const roll = { tableId: 'm-1', lastDay, hoursKept: 12 };
    // Still counting two days after: the server still gives the table, the roll stays.
    expect(rollCanGo({ ...roll, reached: true, assigned: 'm-1' }, at('2027-04-09T12:00:00'))).toBe(false);
    expect(rollCanGo({ ...roll, reached: true, assigned: undefined }, at('2027-04-06T20:00:00'))).toBe(true);
    expect(rollCanGo({ ...roll, reached: true, assigned: 'm-2' }, at('2027-04-06T20:00:00'))).toBe(true);
  });

  it('without the server, once the night after the last day and the hours the profile allows are over', () => {
    const offline = { tableId: 'm-1', reached: false, assigned: 'm-1', lastDay };
    expect(rollCanGo({ ...offline, hoursKept: 0 }, at('2027-04-07T05:00:00'))).toBe(false);
    expect(rollCanGo({ ...offline, hoursKept: 0 }, at('2027-04-07T07:00:00'))).toBe(true);
    expect(rollCanGo({ ...offline, hoursKept: 12 }, at('2027-04-07T17:00:00'))).toBe(false);
    expect(rollCanGo({ ...offline, hoursKept: undefined }, at('2027-04-07T19:00:00'))).toBe(true);
    expect(rollCanGo({ ...offline, lastDay: undefined, hoursKept: 0 }, at('2030-01-01T00:00:00'))).toBe(false);
  });
});
