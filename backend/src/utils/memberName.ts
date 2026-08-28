/**
 * Person-name encoding and punctuation.
 *
 * Names often pick up a curly apostrophe from Word, Excel, or iOS. If those
 * UTF-8 bytes are later read as Windows-1252, U+2019 becomes the three-character
 * mojibake "â€™" (so "D’Agostino" displays as "Dâ€™Agostino").
 */

/** Windows-1252 byte for a Unicode code point that is not latin1-identical. */
const WIN1252_UNICODE_TO_BYTE = new Map<number, number>([
  [0x20ac, 0x80],
  [0x201a, 0x82],
  [0x0192, 0x83],
  [0x201e, 0x84],
  [0x2026, 0x85],
  [0x2020, 0x86],
  [0x2021, 0x87],
  [0x02c6, 0x88],
  [0x2030, 0x89],
  [0x0160, 0x8a],
  [0x2039, 0x8b],
  [0x0152, 0x8c],
  [0x017d, 0x8e],
  [0x2018, 0x91],
  [0x2019, 0x92],
  [0x201c, 0x93],
  [0x201d, 0x94],
  [0x2022, 0x95],
  [0x2013, 0x96],
  [0x2014, 0x97],
  [0x02dc, 0x98],
  [0x2122, 0x99],
  [0x0161, 0x9a],
  [0x203a, 0x9b],
  [0x0153, 0x9c],
  [0x017e, 0x9e],
  [0x0178, 0x9f],
]);

function codePointToWin1252Byte(codePoint: number): number | null {
  if (codePoint < 0x80) return codePoint;
  if (codePoint >= 0xa0 && codePoint <= 0xff) return codePoint;
  return WIN1252_UNICODE_TO_BYTE.get(codePoint) ?? null;
}

function encodeWindows1252(value: string): Uint8Array | null {
  const bytes = new Uint8Array(value.length);
  let i = 0;
  for (const char of value) {
    const codePoint = char.codePointAt(0);
    if (codePoint == null || codePoint > 0xffff) return null;
    const byte = codePointToWin1252Byte(codePoint);
    if (byte == null) return null;
    bytes[i] = byte;
    i += 1;
  }
  return i === bytes.length ? bytes : bytes.subarray(0, i);
}

function encodeLatin1(value: string): Uint8Array | null {
  const bytes = new Uint8Array(value.length);
  let i = 0;
  for (const char of value) {
    const codePoint = char.codePointAt(0);
    if (codePoint == null || codePoint > 0xff) return null;
    bytes[i] = codePoint;
    i += 1;
  }
  return i === bytes.length ? bytes : bytes.subarray(0, i);
}

function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function looksLikeUtf8Mojibake(value: string): boolean {
  return /[\u00C3][\u0080-\u00FF]|[\u00C2][\u0080-\u00FF]|\u00E2\u20AC.|[\u00E2][\u0080-\u00FF]/.test(value);
}

function letterCount(value: string): number {
  return (value.match(/\p{L}/gu) ?? []).length;
}

function isPlausibleMojibakeRepair(original: string, repaired: string): boolean {
  if (!repaired || repaired === original || repaired.includes('\uFFFD')) return false;
  return letterCount(repaired) > 0;
}

function decodeMojibakeOnce(value: string): string | null {
  const candidates = [encodeWindows1252(value), encodeLatin1(value)];
  for (const bytes of candidates) {
    if (!bytes) continue;
    const decoded = decodeUtf8(bytes);
    if (decoded && isPlausibleMojibakeRepair(value, decoded)) return decoded;
  }
  return null;
}

export function repairUtf8Mojibake(value: string): string {
  let current = value;
  for (let i = 0; i < 3; i++) {
    if (!looksLikeUtf8Mojibake(current)) break;
    const decoded = decodeMojibakeOnce(current);
    if (!decoded) break;
    current = decoded;
  }
  return current;
}

function decodeCommonNameEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&apos;|&#0*39;|&#x0*27;/gi, "'")
    .replace(/&lsquo;|&#0*8216;|&#x0*2018;/gi, "'")
    .replace(/&rsquo;|&#0*8217;|&#x0*2019;/gi, "'")
    .replace(/&quot;|&#0*34;|&#x0*22;/gi, '"')
    .replace(/&ldquo;|&#0*8220;|&#x0*201c;/gi, '"')
    .replace(/&rdquo;|&#0*8221;|&#x0*201d;/gi, '"');
}

function normalizeNamePunctuation(value: string): string {
  return value
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u00B4\u02B9\u02BC]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"')
    .replace(/\u00A0/g, ' ')
    .replace(/[\u2013\u2014\u2212]/g, '-');
}

/**
 * Repair encoding damage and normalize punctuation in a person name.
 * Preserves letters with diacritics (José, François) and Hawaiian ʻokina.
 */
export function normalizePersonName(value: string | null | undefined): string {
  if (value == null) return '';
  let normalized = decodeCommonNameEntities(value);
  normalized = repairUtf8Mojibake(normalized);
  normalized = normalized.normalize('NFC');
  normalized = normalizeNamePunctuation(normalized);
  return normalized.replace(/\s+/g, ' ').trim();
}

export function normalizeOptionalPersonName(value: string | null | undefined): string | null {
  if (value == null) return null;
  const normalized = normalizePersonName(value);
  return normalized || null;
}

export function splitMemberDisplayName(full: string): { firstName: string; lastName: string } {
  const trimmed = normalizePersonName(full);
  if (!trimmed) return { firstName: '', lastName: '' };
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

export function formatMemberDisplayName(firstName: string, lastName: string): string {
  return `${normalizePersonName(firstName)} ${normalizePersonName(lastName)}`.replace(/\s+/g, ' ').trim();
}

export function memberNameMatchKey(firstName: string, lastName: string): string {
  return `${normalizePersonName(firstName).toLowerCase()}|${normalizePersonName(lastName).toLowerCase()}`;
}

export function memberNamePartsFromStored(member: {
  name: string;
  first_name?: string | null;
  last_name?: string | null;
}): { firstName: string; lastName: string } {
  const storedFirst = normalizePersonName(member.first_name);
  const storedLast = normalizePersonName(member.last_name);
  if (storedFirst || storedLast) {
    return { firstName: storedFirst, lastName: storedLast };
  }
  return splitMemberDisplayName(member.name);
}

export function memberNameMatchKeyFromFullName(name: string): string | null {
  const trimmed = normalizePersonName(name);
  if (!trimmed) return null;
  const parts = splitMemberDisplayName(trimmed);
  if (!parts.firstName) return null;
  return memberNameMatchKey(parts.firstName, parts.lastName);
}

export function resolveMemberNameFields(input: {
  firstName?: string;
  lastName?: string;
  name?: string;
}): { name: string; firstName: string; lastName: string } | null {
  const trimmedFirst = normalizePersonName(input.firstName);
  const trimmedLast = normalizePersonName(input.lastName);
  if (trimmedFirst && trimmedLast) {
    return {
      firstName: trimmedFirst,
      lastName: trimmedLast,
      name: formatMemberDisplayName(trimmedFirst, trimmedLast),
    };
  }

  const trimmedName = normalizePersonName(input.name);
  if (!trimmedName) return null;

  const split = splitMemberDisplayName(trimmedName);
  return {
    firstName: split.firstName,
    lastName: split.lastName,
    name: trimmedName,
  };
}
