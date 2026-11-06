/**
 * Phone numbers as people write them in Argentina: «0341 15 555-1234», «341 555-1234», «+54 9 341 555 1234».
 * WhatsApp needs them whole and in one form: 54, the 9 of mobiles, the area code without 0 and the number without 15.
 * A number with no area code («15 555-1234») cannot be completed, because it is not known where it is from.
 */
const MOBILE = '549';

/** The number in international form, «+5493415551234», or null when it cannot be told for sure. */
export function internationalPhone(typed: string | null | undefined): string | null {
  const text = (typed ?? '').trim();
  let digits = text.replace(/\D/g, '');
  if (!digits) return null;
  let international = text.startsWith('+') || digits.startsWith('00');
  if (digits.startsWith('00')) digits = digits.slice(2);
  // No Argentine area code starts with 5, so «549…» without the plus is the international form too.
  if (!international && digits.startsWith('54') && digits.length >= 12) international = true;
  if (international) {
    if (!digits.startsWith('54')) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
    digits = digits.slice(2);
    if (digits.startsWith('9')) digits = digits.slice(1);
  }
  if (digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length === 12) {
    // The 15 goes right after the area code, which has 2 digits in Buenos Aires (11) and 3 or 4 elsewhere.
    const at = digits.startsWith('11') ? 2 : digits.slice(3, 5) === '15' ? 3 : 4;
    if (digits.slice(at, at + 2) !== '15') return null;
    digits = digits.slice(0, at) + digits.slice(at + 2);
  }
  // Area codes start with 11, 2 or 3. Without the 15 a number may be a landline: it is taken as a mobile,
  // because these numbers are for WhatsApp and for calling someone during the election.
  if (digits.length !== 10 || !/^(11|2|3)/.test(digits)) return null;
  return `+${MOBILE}${digits}`;
}

/** What goes after wa.me/, or null when the number cannot be completed. */
export function whatsappDigits(typed: string | null | undefined): string | null {
  return internationalPhone(typed)?.slice(1) ?? null;
}

/** How a phone is kept: in international form if it can be, or else as it was typed. */
export function storedPhone(typed: unknown): string | null {
  if (typeof typed !== 'string' || !typed.trim()) return null;
  return internationalPhone(typed) ?? typed.trim().slice(0, 40);
}
