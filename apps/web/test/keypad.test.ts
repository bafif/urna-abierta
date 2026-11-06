import { describe, expect, it } from 'vitest';
import { pressDigit } from '../src/lib/keypad.ts';

const type = (digits: string, code = false) => [...digits].reduce((value, digit) => pressDigit(value, Number(digit), code), '');

describe('the keypad', () => {
  it('a count drops the zero it starts at, and takes six digits at most', () => {
    expect(type('05')).toBe('5');
    expect(type('120')).toBe('120');
    expect(type('1234567')).toBe('123456');
  });

  it('a second-step code keeps a zero in front, so that it can be typed whole', () => {
    expect(type('082791', true)).toBe('082791');
    expect(type('000000', true)).toBe('000000');
    expect(type('0827915', true)).toBe('082791');
  });
});
