import { describe, expect, it } from 'vitest';
import { rollCanGo, startOfDay } from '../src/lib/roll-release.ts';

const lastDay = '2027-04-06';
const timeZone = 'America/Argentina/Buenos_Aires';
const at = (moment: string) => Date.parse(moment);

describe('when the roll leaves the phone', () => {
  it('with the server at hand, only once the server no longer gives that table, however late it is', () => {
    const roll = { tableId: 'm-1', lastDay, hoursKept: 12, timeZone, clockOffset: 0 };
    // Still counting two days after: the server still gives the table, the roll stays.
    expect(rollCanGo({ ...roll, reached: true, assigned: 'm-1' }, at('2027-04-09T12:00:00-03:00'))).toBe(false);
    expect(rollCanGo({ ...roll, reached: true, assigned: undefined }, at('2027-04-06T20:00:00-03:00'))).toBe(true);
    expect(rollCanGo({ ...roll, reached: true, assigned: 'm-2' }, at('2027-04-06T20:00:00-03:00'))).toBe(true);
  });

  it('without the server, once the night after the last day and the hours the profile allows are over', () => {
    const offline = { tableId: 'm-1', reached: false, assigned: 'm-1', lastDay, timeZone, clockOffset: 0 };
    expect(rollCanGo({ ...offline, hoursKept: 0 }, at('2027-04-07T05:00:00-03:00'))).toBe(false);
    expect(rollCanGo({ ...offline, hoursKept: 0 }, at('2027-04-07T07:00:00-03:00'))).toBe(true);
    expect(rollCanGo({ ...offline, hoursKept: 12 }, at('2027-04-07T17:00:00-03:00'))).toBe(false);
    expect(rollCanGo({ ...offline, hoursKept: undefined }, at('2027-04-07T19:00:00-03:00'))).toBe(true);
    expect(rollCanGo({ ...offline, lastDay: undefined, hoursKept: 0 }, at('2030-01-01T00:00:00-03:00'))).toBe(false);
  });

  it('by the server clock and where the election happens, whatever date and zone the phone has', () => {
    // A national election, a phone with no signal whose clock is a day ahead: at 07:30 on election day it keeps the roll.
    const national = { tableId: 'm-1', reached: false, assigned: 'm-1', lastDay: '2027-10-24', hoursKept: 0, timeZone };
    const phoneSays = at('2027-10-25T07:30:00-03:00');
    expect(rollCanGo({ ...national, clockOffset: -24 * 3_600_000 }, phoneSays)).toBe(false);
    expect(rollCanGo({ ...national, clockOffset: 0 }, phoneSays)).toBe(true);
    // The 06:00 is the one in Argentina, also for a phone set to Madrid, five hours ahead.
    expect(rollCanGo({ ...national, clockOffset: 0 }, at('2027-10-25T05:30:00-03:00'))).toBe(false);
    expect(rollCanGo({ ...national, timeZone: 'Europe/Madrid', clockOffset: 0 }, at('2027-10-25T05:30:00-03:00'))).toBe(true);
    // An election that does not say where it is takes the zone elections have unless they say otherwise.
    expect(rollCanGo({ ...national, timeZone: undefined, clockOffset: 0 }, at('2027-10-25T05:30:00-03:00'))).toBe(false);
  });

  it('knows when a day starts in a zone, also on a day the clocks change', () => {
    expect(startOfDay('2027-04-06', timeZone)).toBe(at('2027-04-06T00:00:00-03:00'));
    expect(startOfDay('2027-04-06', 'UTC')).toBe(at('2027-04-06T00:00:00Z'));
    // Madrid moves to summer time at 02:00 on 28 March 2027: that midnight is still winter time, the next one is not.
    expect(startOfDay('2027-03-28', 'Europe/Madrid')).toBe(at('2027-03-28T00:00:00+01:00'));
    expect(startOfDay('2027-03-29', 'Europe/Madrid')).toBe(at('2027-03-29T00:00:00+02:00'));
    expect(startOfDay('2027-04-06', 'not a zone')).toBe(at('2027-04-06T00:00:00-03:00'));
  });
});
