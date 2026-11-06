import { describe, expect, it } from 'vitest';
import { dayIn, internationalPhone, isTimeZone, storedPhone, whatsappDigits } from '../src/index.ts';

describe('phone numbers as people write them', () => {
  const rosario = '+5493415551234';
  const buenosAires = '+5491155551234';

  it.each([
    ['0341 15 555-1234', rosario],
    ['0341-15-555-1234', rosario],
    ['(0341) 155-551234', rosario],
    ['341 15 5551234', rosario],
    ['341 555-1234', rosario],
    ['0341 555 1234', rosario],
    ['+54 9 341 555-1234', rosario],
    ['+54 341 555 1234', rosario],
    ['+54 9 341 15 555 1234', rosario],
    ['0054 9 341 5551234', rosario],
    ['5493415551234', rosario],
    ['011 15 5555-1234', buenosAires],
    ['11 15 5555 1234', buenosAires],
    ['11-5555-1234', buenosAires],
    ['+54 9 11 5555-1234', buenosAires],
    ['02966 15 123456', '+5492966123456'],
    ['2966 15-12-3456', '+5492966123456'],
  ])('«%s» is %s', (typed, expected) => {
    expect(internationalPhone(typed)).toBe(expected);
    expect(whatsappDigits(typed)).toBe(expected.slice(1));
  });

  it.each([
    ['15 555-1234'],
    ['15-5555-1234'],
    ['555-1234'],
    ['0341 16 555-1234 9'],
    [''],
    ['   '],
    ['sin teléfono'],
  ])('«%s» cannot be completed', (typed) => {
    expect(internationalPhone(typed)).toBeNull();
    expect(whatsappDigits(typed)).toBeNull();
  });

  it('a number from another country stays as it is', () => {
    expect(internationalPhone('+1 (202) 555-0123')).toBe('+12025550123');
    expect(internationalPhone('+598 99 123 456')).toBe('+59899123456');
  });

  it('is kept in international form when it can be, and as typed when not', () => {
    expect(storedPhone(' 0341 15 555-1234 ')).toBe(rosario);
    expect(storedPhone('15 555-1234')).toBe('15 555-1234');
    expect(storedPhone('')).toBeNull();
    expect(storedPhone(undefined)).toBeNull();
    expect(storedPhone(341)).toBeNull();
  });
});

describe('the day in the time zone of the election', () => {
  it('at ten at night in Argentina it is still that day, though in Greenwich it is the next', () => {
    const tenAtNight = new Date('2027-04-07T01:00:00Z');
    expect(dayIn('America/Argentina/Buenos_Aires', tenAtNight)).toBe('2027-04-06');
    expect(dayIn('UTC', tenAtNight)).toBe('2027-04-07');
    expect(dayIn('America/Argentina/Buenos_Aires', new Date('2027-04-07T03:00:00Z'))).toBe('2027-04-07');
  });

  it('a zone that does not exist falls back to Argentina', () => {
    expect(isTimeZone('America/Argentina/Cordoba')).toBe(true);
    expect(isTimeZone('Marte/Olympus')).toBe(false);
    expect(dayIn('Marte/Olympus', new Date('2027-04-07T01:00:00Z'))).toBe('2027-04-06');
  });

  it('only a name of the time zone database counts, never an offset that Postgres would read backwards', () => {
    for (const name of ['UTC', 'America/Argentina/Buenos_Aires', 'Europe/Madrid', 'Etc/GMT+3']) expect(isTimeZone(name)).toBe(true);
    for (const offset of ['-0300', '-03:00', '+03:00', '-3', 'GMT+3', 'EST5EDT', 'utc', 'america/argentina/buenos_aires', '']) expect(isTimeZone(offset)).toBe(false);
  });
});
