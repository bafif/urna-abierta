import { describe, expect, it } from 'vitest';
import { addDays, daysUntil, purgeNotice } from '../src/lib/purge.ts';

describe('the deadline to erase the names', () => {
  it('counts days across months, and negative once it passed', () => {
    expect(addDays('2027-04-08', 30)).toBe('2027-05-08');
    expect(daysUntil('2027-05-08', '2027-05-01')).toBe(7);
    expect(daysUntil('2027-05-08', '2027-05-10')).toBe(-2);
  });

  it('warns from a week before, keeps warning after, and never once the names are gone', () => {
    const election = { status: 'cerrada', purge_by: '2027-05-08' };
    expect(purgeNotice(election, '2027-04-30')).toBeNull();
    expect(purgeNotice(election, '2027-05-01')).toEqual({ left: 7 });
    expect(purgeNotice(election, '2027-05-12')).toEqual({ left: -4 });
    expect(purgeNotice({ ...election, status: 'purgada' }, '2027-05-12')).toBeNull();
    expect(purgeNotice({ status: 'cerrada', purge_by: null }, '2027-05-12')).toBeNull();
  });
});
