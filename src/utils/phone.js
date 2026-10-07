/**
 * Nigerian phone number normalisation (workplan assumption 5: one city,
 * fictional +234 8xx range).
 *
 * Accepts the shapes that reach us in practice:
 *   +2348012345678 / 2348012345678 / 08012345678 / 23408012345678
 * Returns E.164 (+2348012345678) or null when the number is not usable.
 */

const NIGERIAN_E164 = /^\+234[789]\d{9}$/;

/**
 * @param {unknown} raw
 * @returns {string|null} normalised E.164 phone number or null
 */
export function normalisePhone(raw) {
  if (typeof raw !== 'string') return null;

  let digits = raw.trim().replace(/[\s().-]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  if (!/^\d+$/.test(digits)) return null;

  if (digits.length === 11 && digits.startsWith('0')) {
    digits = `234${digits.slice(1)}`; // 08012345678 -> 2348012345678
  } else if (digits.length === 14 && digits.startsWith('2340')) {
    digits = `234${digits.slice(4)}`; // 23408012345678 -> 2348012345678
  }

  if (!digits.startsWith('234')) return null; // v1 supports Nigerian numbers only

  const candidate = `+${digits}`;
  return NIGERIAN_E164.test(candidate) ? candidate : null;
}

/** True when `raw` normalises to a usable Nigerian E.164 number. */
export function isValidNigerianPhone(raw) {
  return normalisePhone(raw) !== null;
}

/** Converts E.164 (+234...) into the wa_id format the Cloud API expects (234...). */
export function toWaId(phone) {
  return String(phone).replace(/^\+/, '');
}

/**
 * Masks the middle of a phone number for operational logs:
 * +2348012345678 -> +234801***78
 */
export function maskPhone(phone) {
  const value = String(phone ?? '');
  if (value.length <= 7) return '***';
  return `${value.slice(0, 7)}***${value.slice(-2)}`;
}
