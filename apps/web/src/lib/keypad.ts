export const MAX_DIGITS = 6;

/**
 * What the keypad holds after a digit is tapped. A count starts at zero and drops it with the first digit; a code
 * keeps every digit it is typed with, a zero in front too: one second-step code in ten starts with one.
 */
export function pressDigit(value: string, digit: number, code = false): string {
  if (value.length >= MAX_DIGITS) return value;
  return !code && value === '0' ? String(digit) : value + digit;
}
