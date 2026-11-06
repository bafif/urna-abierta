import { strFromU8, unzipSync } from 'fflate';

/** One row of a sheet: its number as the spreadsheet shows it, and its cells as text, with empty cells as ''. */
export interface SheetRow {
  line: number;
  cells: string[];
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** XML text, plus the _xHHHH_ escapes that Office uses for characters XML cannot carry. */
function decode(text: string): string {
  return text
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, name: string) => {
      if (name[0] === '#') {
        const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
      }
      return ENTITIES[name] ?? whole;
    })
    .replace(/_x([0-9a-f]{4})_/gi, (_, code: string) => String.fromCharCode(parseInt(code, 16)));
}

/** Elements may come with a namespace prefix (x:c instead of c), depending on the program that wrote the file. */
const tag = (name: string, flags = 'g') => new RegExp(`<(?:[\\w.-]+:)?${name}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</(?:[\\w.-]+:)?${name}>)`, flags);
const TEXT = tag('t');
const PHONETIC = tag('rPh');
const STRING_ITEM = tag('si');
const RELATIONSHIP = tag('Relationship');
const ROW = tag('row');
const CELL = tag('c');
const FIRST_SHEET = tag('sheet', '');
const SHEET_DATA = tag('sheetData', '');
const VALUE = tag('v', '');
const INLINE = tag('is', '');
const NUMBER_FORMAT = tag('numFmt');
const CELL_FORMATS = tag('cellXfs', '');
const CELL_FORMAT = tag('xf');
const ATTRIBUTES = new Map<string, RegExp>();
function attribute(attributes: string, name: string): string | undefined {
  let pattern = ATTRIBUTES.get(name);
  if (!pattern) ATTRIBUTES.set(name, (pattern = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`)));
  const match = pattern.exec(attributes);
  return match ? (match[1] ?? match[2]) : undefined;
}

/** The visible text of a string item: its own text and its rich text runs, without phonetic guides. */
function textOf(xml: string): string {
  const visible = xml.replace(PHONETIC, '');
  return [...visible.matchAll(TEXT)].map((match) => decode(match[2] ?? '')).join('');
}

/** A number as a person typed it: a document stored as a number comes out as 30123456, never as 30123456.0 or 3.0123456E7. */
function numberText(raw: string): string {
  const value = Number(raw);
  if (raw.trim() === '' || !Number.isFinite(value)) return raw.trim();
  const whole = Math.round(value);
  if (Number.isSafeInteger(whole) && Math.abs(value - whole) <= 1e-9 * Math.max(1, Math.abs(value))) return whole.toFixed(0);
  return String(value);
}

/**
 * For each cell style, how many digits its number format fills with zeros, or 0. Only a format of zeros alone («000000») counts:
 * it is how a sheet shows a legajo or a table as 001234 while keeping a number inside.
 */
function zeroPadding(styles: string | undefined): number[] {
  if (!styles) return [];
  const custom = new Map([...styles.matchAll(NUMBER_FORMAT)].map((match) => [attribute(match[1]!, 'numFmtId'), decode(attribute(match[1]!, 'formatCode') ?? '')]));
  const formats = CELL_FORMATS.exec(styles)?.[2] ?? '';
  return [...formats.matchAll(CELL_FORMAT)].map((match) => {
    const code = custom.get(attribute(match[1]!, 'numFmtId')) ?? '';
    return /^0+$/.test(code) ? code.length : 0;
  });
}

const padded = (text: string, digits: number) => (digits > 0 && /^\d+$/.test(text) ? text.padStart(digits, '0') : text);

/** Column letters to a position: A is 0, Z is 25, AA is 26. */
function columnIndex(reference: string | undefined): number | null {
  const letters = /^([A-Z]+)/i.exec(reference ?? '')?.[1]?.toUpperCase();
  if (!letters) return null;
  return [...letters].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

/** Where a relationship points, from the folder of the file that declares it. */
function resolve(base: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/').filter(Boolean);
  for (const part of target.split('/')) {
    if (part === '..') parts.pop();
    else if (part !== '.' && part !== '') parts.push(part);
  }
  return parts.join('/');
}

function relationships(files: Record<string, Uint8Array>, path: string): { id: string; type: string; target: string }[] {
  const file = files[path];
  if (!file) return [];
  return [...strFromU8(file).matchAll(RELATIONSHIP)].map((match) => ({
    id: attribute(match[1]!, 'Id') ?? '',
    type: attribute(match[1]!, 'Type') ?? '',
    target: decode(attribute(match[1]!, 'Target') ?? ''),
  }));
}

/** What the parts of an Excel or .padron file that get read may take once unpacked: far more than any real roll, and little enough for a phone. */
export const MAX_UNZIPPED_BYTES = 64 * 1024 * 1024;

export interface Unzipped {
  files: Record<string, Uint8Array>;
  /** Every name in the ZIP, unpacked or not. */
  names: string[];
}

/**
 * The files of a ZIP that `wanted` picks. It refuses before unpacking anything big when the sizes those files declare add up to
 * more than `limit`. Each file is unpacked into a buffer of the size it declares, so one that lies about it cannot take more.
 */
export function unzipSome(bytes: Uint8Array, wanted: (name: string) => boolean, limit = MAX_UNZIPPED_BYTES): Unzipped | 'not_a_zip' | 'too_big' {
  const names: string[] = [];
  let total = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: (file) => {
        names.push(file.name);
        if (!wanted(file.name)) return false;
        total += file.originalSize;
        return total <= limit;
      },
    });
  } catch {
    return 'not_a_zip';
  }
  return total > limit ? 'too_big' : { files, names };
}

/** The first worksheet of an .xlsx file, as rows of text, or why it cannot be read. */
export function readFirstSheet(bytes: Uint8Array): SheetRow[] | 'not_a_spreadsheet' | 'too_big' {
  // First the small parts that say where everything is. Pictures and anything else inside the file are never unpacked.
  const index = unzipSome(bytes, (name) => /\.rels$/i.test(name) || /(^|\/)workbook\.xml$/i.test(name));
  if (index === 'not_a_zip') return 'not_a_spreadsheet';
  if (index === 'too_big') return 'too_big';
  const { files, names } = index;
  const office = relationships(files, '_rels/.rels').find((rel) => rel.type.endsWith('/officeDocument'));
  const workbookPath = office ? resolve('', office.target) : 'xl/workbook.xml';
  const workbookFile = files[workbookPath];
  if (!workbookFile) return 'not_a_spreadsheet';
  const folder = workbookPath.split('/').slice(0, -1).join('/');
  const inFolder = (name: string) => (folder ? `${folder}/${name}` : name);
  const links = relationships(files, inFolder(`_rels/${workbookPath.split('/').pop()}.rels`));

  const firstSheet = FIRST_SHEET.exec(strFromU8(workbookFile));
  const sheetId = firstSheet ? (attribute(firstSheet[1]!, 'r:id') ?? attribute(firstSheet[1]!, '[\\w.-]+:id')) : undefined;
  const sheetLink = links.find((rel) => rel.id === sheetId);
  const fallback = names.filter((name) => /^xl\/worksheets\/[^/]+\.xml$/i.test(name)).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))[0];
  const sheetPath = sheetLink ? resolve(folder, sheetLink.target) : fallback;
  if (!sheetPath) return 'not_a_spreadsheet';
  const linked = (type: string, name: string) => {
    const link = links.find((rel) => rel.type.endsWith(type));
    return link ? resolve(folder, link.target) : inFolder(name);
  };
  const stringsPath = linked('/sharedStrings', 'sharedStrings.xml');
  const stylesPath = linked('/styles', 'styles.xml');

  // Then only the sheet, its texts and its formats.
  const parts = unzipSome(bytes, (name) => name === sheetPath || name === stringsPath || name === stylesPath);
  if (parts === 'not_a_zip') return 'not_a_spreadsheet';
  if (parts === 'too_big') return 'too_big';
  const sheetFile = parts.files[sheetPath];
  if (!sheetFile) return 'not_a_spreadsheet';
  const stringsFile = parts.files[stringsPath];
  const shared = stringsFile ? [...strFromU8(stringsFile).matchAll(STRING_ITEM)].map((match) => textOf(match[2] ?? '')) : [];
  const stylesFile = parts.files[stylesPath];
  const padding = zeroPadding(stylesFile ? strFromU8(stylesFile) : undefined);

  const sheet = strFromU8(sheetFile);
  const data = SHEET_DATA.exec(sheet)?.[2] ?? '';
  const rows: SheetRow[] = [];
  let lastLine = 0;
  for (const rowMatch of data.matchAll(ROW)) {
    const line = Number(attribute(rowMatch[1]!, 'r')) || lastLine + 1;
    lastLine = line;
    const cells: string[] = [];
    for (const cellMatch of (rowMatch[2] ?? '').matchAll(CELL)) {
      const attributes = cellMatch[1]!;
      const inner = cellMatch[2] ?? '';
      const type = attribute(attributes, 't') ?? 'n';
      const raw = decode(VALUE.exec(inner)?.[2] ?? '');
      const value =
        type === 's' ? (shared[Number(raw)] ?? '')
        : type === 'inlineStr' ? textOf(INLINE.exec(inner)?.[2] ?? '')
        : type === 'str' ? raw
        : type === 'e' ? ''
        : type === 'b' ? raw
        : padded(numberText(raw), padding[Number(attribute(attributes, 's') ?? 0)] ?? 0);
      const at = columnIndex(attribute(attributes, 'r')) ?? cells.length;
      while (cells.length < at) cells.push('');
      cells[at] = value.trim();
    }
    rows.push({ line, cells });
  }
  return rows;
}
