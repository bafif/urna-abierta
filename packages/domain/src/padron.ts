import { strFromU8, strToU8, zipSync } from 'fflate';
import * as v from 'valibot';
import { MAX_UNZIPPED_BYTES, readFirstSheet, unzipSome, type SheetRow } from './xlsx.ts';

export { MAX_UNZIPPED_BYTES };

/** The largest roll file the server takes. The browser checks it too, before reading a file. */
export const MAX_ROLL_BYTES = 64 * 1024 * 1024;

/** The open roll format: a ZIP with manifest.json, units.jsonl and electors.jsonl. */
export const PADRON_FORMAT = 'padron-abierto';
export const PADRON_MAJOR = 0;

const text = (max: number) => v.pipe(v.string(), v.minLength(1), v.maxLength(max));

export const manifestSchema = v.looseObject({
  format: v.literal(PADRON_FORMAT),
  format_version: v.pipe(v.string(), v.regex(/^\d+\.\d+\.\d+$/)),
  title: v.optional(text(200)),
  created_at: v.optional(v.string()),
  extraction: v.optional(v.looseObject({ external_ai: v.optional(v.boolean()) })),
  levels: v.optional(v.array(text(40))),
  extra_fields: v.optional(v.array(v.looseObject({ key: text(40), label: v.optional(text(80)) }))),
  files: v.object({
    units: v.optional(v.object({ path: text(100), count: v.number() })),
    electors: v.object({ path: text(100), count: v.number() }),
  }),
});

export const unitSchema = v.looseObject({
  id: text(64),
  level: v.optional(text(40)),
  name: text(120),
  parent: v.optional(v.nullable(text(64))),
  declared_total: v.optional(v.number()),
});

export const electorSchema = v.looseObject({
  id: text(64),
  full_name: text(200),
  table: v.optional(v.nullable(text(64))),
  order: v.optional(v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1)))),
  family_name: v.optional(text(120)),
  given_names: v.optional(text(120)),
  identifiers: v.optional(v.array(v.object({ type: text(20), value: text(40) }))),
  address: v.optional(v.nullable(text(200))),
  birth_year: v.optional(v.nullable(v.number())),
  extra: v.optional(v.record(v.string(), v.unknown())),
  review: v.optional(v.looseObject({ status: v.picklist(['ok', 'pending']) })),
});

export type PadronManifest = v.InferOutput<typeof manifestSchema>;
export type PadronUnit = v.InferOutput<typeof unitSchema>;
export type PadronElector = v.InferOutput<typeof electorSchema>;

export interface Padron {
  manifest: PadronManifest;
  units: PadronUnit[];
  electors: PadronElector[];
}

export interface PadronProblem {
  /** Where: a file and, when it applies, its line. Never the content of a row. */
  where: string;
  problem: string;
}

export interface PadronRead {
  padron: Padron | null;
  problems: PadronProblem[];
}

const splitLines = (content: string) => content.split('\n').filter((line) => line.trim() !== '');

/** The field a row fails on, and whether it is only too long: what a person needs to fix it, never what it says. */
function problemOf(issues: readonly v.BaseIssue<unknown>[]): string {
  const issue = issues[0];
  const field = issue?.path?.[0]?.key ?? 'row';
  return `${issue?.type === 'max_length' ? 'too_long' : 'invalid'}:${String(field)}`;
}

function readLines<T>(file: string, content: string, schema: v.GenericSchema<unknown, T>, problems: PadronProblem[]): { row: T; line: number }[] {
  const rows: { row: T; line: number }[] = [];
  splitLines(content).forEach((line, index) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      problems.push({ where: `${file}:${index + 1}`, problem: 'not_json' });
      return;
    }
    const result = v.safeParse(schema, parsed);
    if (result.success) rows.push({ row: result.output, line: index + 1 });
    else problems.push({ where: `${file}:${index + 1}`, problem: problemOf(result.issues) });
  });
  return rows;
}

const refused = (where: string, problem: string): PadronRead => ({ padron: null, problems: [{ where, problem }] });

/**
 * Reads and checks a .padron file. An unknown major version is refused; unknown fields are ignored.
 * Only the manifest and the files it names are unpacked, and never more than MAX_UNZIPPED_BYTES.
 */
export function readPadron(bytes: Uint8Array): PadronRead {
  const problems: PadronProblem[] = [];
  const head = unzipSome(bytes, (name) => name === 'manifest.json', 1024 * 1024);
  if (head === 'not_a_zip') return refused('file', 'not_a_zip');
  if (head === 'too_big') return refused('file', 'too_big');
  const manifestFile = head.files['manifest.json'];
  if (!manifestFile) return refused('file', 'missing_manifest');
  let rawManifest: unknown;
  try {
    rawManifest = JSON.parse(strFromU8(manifestFile));
  } catch {
    return refused('manifest.json', 'not_json');
  }
  const parsedManifest = v.safeParse(manifestSchema, rawManifest);
  if (!parsedManifest.success) return refused('manifest.json', 'invalid');
  const manifest = parsedManifest.output;
  if (Number(manifest.format_version.split('.')[0]) !== PADRON_MAJOR) return refused('manifest.json', 'unsupported_version');
  const paths = [manifest.files.electors.path, manifest.files.units?.path];
  const body = unzipSome(bytes, (name) => paths.includes(name));
  if (body === 'not_a_zip') return refused('file', 'not_a_zip');
  if (body === 'too_big') return refused('file', 'too_big');
  const electorsFile = body.files[manifest.files.electors.path];
  if (!electorsFile) return refused(manifest.files.electors.path, 'missing_file');
  const unitsFile = manifest.files.units ? body.files[manifest.files.units.path] : undefined;
  const units = unitsFile ? readLines('units', strFromU8(unitsFile), unitSchema, problems).map(({ row }) => row) : [];
  const rows = readLines('electors', strFromU8(electorsFile), electorSchema, problems);
  if (rows.length + problems.filter((p) => p.where.startsWith('electors')).length !== manifest.files.electors.count) {
    problems.push({ where: 'manifest.json', problem: 'count_mismatch' });
  }
  const seen = new Set<string>();
  const unitIds = new Set(units.map((unit) => unit.id));
  const electors: PadronElector[] = [];
  for (const { row: elector, line } of rows) {
    // Two rows with one id cannot both be loaded: the first one stays, as in a spreadsheet, and the repeat is pointed out.
    if (seen.has(elector.id)) {
      problems.push({ where: `electors:${line}`, problem: 'repeated_id' });
      continue;
    }
    seen.add(elector.id);
    if (elector.table && unitIds.size > 0 && !unitIds.has(elector.table)) problems.push({ where: `electors:${line}`, problem: 'unknown_table' });
    electors.push(elector);
  }
  return { padron: { manifest, units, electors }, problems };
}

/** Writes a .padron file, for tests and for tools that already have the data. */
export function writePadron({ title, units = [], electors, externalAi = false }: { title?: string; units?: PadronUnit[]; electors: PadronElector[]; externalAi?: boolean }): Uint8Array {
  const manifest = {
    format: PADRON_FORMAT,
    format_version: '0.1.0',
    title,
    extraction: { external_ai: externalAi },
    files: { units: { path: 'units.jsonl', count: units.length }, electors: { path: 'electors.jsonl', count: electors.length } },
  };
  const lines = (rows: unknown[]) => strToU8(rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
  return zipSync({ 'manifest.json': strToU8(JSON.stringify(manifest, null, 2)), 'units.jsonl': lines(units), 'electors.jsonl': lines(electors) });
}

/** Where the roll reader for scanned PDFs is explained and downloaded from, in Spanish and in English. */
export const ROLL_READER_URL = 'https://github.com/bafif/urna-abierta-padrones#descargar';
export const ROLL_READER_URL_EN = 'https://github.com/bafif/urna-abierta-padrones/blob/main/README.en.md#download';

/** «Nº de orden», «Nro. de orden», «Número de orden»… */
const numbered = (noun: string) => ['nº', 'nro', 'numero', 'num'].flatMap((prefix) => [`${prefix} ${noun}`, `${prefix} de ${noun}`]);

/** Headers as headerKey leaves them. Any other column is ignored, whatever it holds. */
const HEADERS: Record<string, readonly string[]> = {
  full_name: ['nombre completo', 'apellido y nombre', 'apellido y nombres', 'apellidos y nombres', 'nombre y apellido', 'nombres y apellidos', 'nombre', 'full_name', 'name'],
  family: ['apellido', 'apellidos', 'family_name'],
  given: ['nombres', 'given_names'],
  document: ['dni', 'documento', ...numbered('documento'), ...numbered('dni'), 'document'],
  file_number: ['legajo', ...numbered('legajo')],
  order: ['orden', 'nº', 'nro', 'numero', 'num', ...numbered('orden'), 'order'],
  table: ['mesa', ...numbered('mesa'), 'table'],
  address: ['domicilio', 'direccion', 'address'],
};

/** A header as it is compared: lowercase, without accents or dots, with the degree sign as º and single spaces. «N°», «n.º» and «Nº» are one. */
const headerKey = (text: string) =>
  text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/°/g, 'º').replace(/\./g, '').replace(/\s+/g, ' ').trim();

/** An Argentine DNI has 7 or 8 digits. Any other length is kept, for a person to check. */
const DOCUMENT = /^\d{7,8}$/;

/** What the scanner strips from both ends of a legajo. */
const EDGE_NOISE = new Set('|!¡[]{}()_-—–=~*+"\'“”‘’`´.,:;¿?<>«»\\/$€%&#@^ ');

/**
 * A legajo written the way the scanner writes it, so that a spreadsheet and a scanned PDF of the same roll give the same id:
 * no spaces, upper case, no stray marks at the ends and one kind of dash. Without a digit there is no legajo.
 */
export function fileNumberOf(raw: string | undefined): string | undefined {
  const chars = [...(raw ?? '').replace(/\s+/g, '').toUpperCase()];
  while (chars.length > 0 && EDGE_NOISE.has(chars[0]!)) chars.shift();
  while (chars.length > 0 && EDGE_NOISE.has(chars[chars.length - 1]!)) chars.pop();
  const text = chars.join('');
  return /\d/.test(text) ? text.replace(/[:—–_]/g, '-') : undefined;
}

/** How many rows to look at for the header: a sheet often starts with a title or a date above it. */
const HEADER_SEARCH = 10;

type Columns = Record<string, number>;

/** The columns a header row names, or null when it names neither a full name nor a family name. */
function columnsOf(cells: string[]): Columns | null {
  const headers = cells.map(headerKey);
  const columns = Object.fromEntries(Object.keys(HEADERS).map((name) => [name, headers.findIndex((header) => HEADERS[name]!.includes(header))])) as Columns;
  return columns.full_name! < 0 && columns.family! < 0 ? null : columns;
}

/**
 * A roll from the rows of a simple table, the same for a CSV and for a spreadsheet. A row with nothing in it is skipped: Excel
 * writes the empty rows inside a sheet as «;;» in a CSV. Unknown columns are ignored, so nothing else the sheet keeps gets in.
 * Ids are the scanner's, so that loading a corrected file again keeps each person where they were: d-<DNI>; without a DNI,
 * l-<legajo>; with neither, f-<position after the header>. Each person is checked with the same rules as a .padron, so what the
 * server would drop is pointed out here, by the row the spreadsheet shows.
 */
function readTableRoll(allRows: SheetRow[], path: string): PadronRead {
  const rows = allRows.filter((row) => row.cells.some((cell) => cell.trim() !== ''));
  if (rows.length === 0) return refused('file', 'empty');
  const header = rows.slice(0, HEADER_SEARCH).findIndex((row) => columnsOf(row.cells));
  if (header < 0) return refused(`line ${rows[0]!.line}`, 'no_name_column');
  const columns = columnsOf(rows[header]!.cells)!;
  const problems: PadronProblem[] = [];
  const electors: PadronElector[] = [];
  const seen = new Set<string>();
  rows.slice(header + 1).forEach(({ line, cells }, index) => {
    const where = `line ${line}`;
    const cell = (name: string) => { const at = columns[name]!; return at >= 0 ? cells[at]?.trim() || undefined : undefined; };
    const family = cell('family');
    const given = cell('given');
    const fullName = cell('full_name') ?? [family, given].filter(Boolean).join(', ');
    if (!fullName) { problems.push({ where, problem: 'no_name' }); return; }
    const digits = cell('document')?.replace(/\D/g, '') || undefined;
    const document = digits && DOCUMENT.test(digits) ? digits : undefined;
    const fileNumber = fileNumberOf(cell('file_number'));
    const order = Number(cell('order'));
    const id = document ? `d-${document}` : fileNumber ? `l-${fileNumber}` : `f-${index + 1}`;
    // Two rows with one id cannot both be loaded: the first one stays, and the repeat is pointed out.
    if (seen.has(id)) { problems.push({ where, problem: 'repeated_id' }); return; }
    const checked = v.safeParse(electorSchema, {
      id,
      full_name: fullName,
      table: cell('table') ?? null,
      order: Number.isInteger(order) && order > 0 ? order : null,
      address: cell('address') ?? null,
      identifiers: [...(digits ? [{ type: 'DNI', value: digits }] : []), ...(fileNumber ? [{ type: 'legajo', value: fileNumber }] : [])],
      // A document of another length goes in as it is, marked for review, and is not used as the id.
      review: { status: digits && !document ? 'pending' : 'ok' },
    });
    if (!checked.success) { problems.push({ where, problem: problemOf(checked.issues) }); return; }
    seen.add(id);
    if (digits && !document) problems.push({ where, problem: 'odd_document' });
    electors.push(checked.output);
  });
  return {
    padron: { manifest: { format: PADRON_FORMAT, format_version: '0.1.0', files: { electors: { path, count: electors.length } } }, units: [], electors },
    problems,
  };
}

function splitCsvLine(line: string, separator: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]!;
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') { cell += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === separator) { cells.push(cell); cell = ''; }
    else cell += char;
  }
  cells.push(cell);
  return cells.map((value) => value.trim());
}

const SEPARATORS = [';', ',', '\t'];

/** The separator that turns one of the first lines into a header; else the one the first line uses most. */
function separatorOf(lines: string[]): string {
  for (const line of lines.slice(0, HEADER_SEARCH)) {
    const fits = SEPARATORS.filter((separator) => columnsOf(splitCsvLine(line, separator)));
    if (fits.length > 0) return fits.sort((a, b) => splitCsvLine(line, b).length - splitCsvLine(line, a).length)[0]!;
  }
  const first = lines[0] ?? '';
  return [...SEPARATORS].sort((a, b) => first.split(b).length - first.split(a).length)[0]!;
}

/** A simple spreadsheet is enough to use the app without the scanner. */
export function readCsvRoll(content: string): PadronRead {
  const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/).map((text, index) => ({ text, line: index + 1 })).filter(({ text }) => text.trim() !== '');
  const separator = separatorOf(lines.map(({ text }) => text));
  return readTableRoll(lines.map(({ text, line }) => ({ line, cells: splitCsvLine(text, separator) })), 'csv');
}

/** The first sheet of an Excel file (.xlsx), with the same columns and ids as a CSV. */
export function readXlsxRoll(bytes: Uint8Array): PadronRead {
  const rows = readFirstSheet(bytes);
  return typeof rows === 'string' ? refused('file', rows) : readTableRoll(rows, 'xlsx');
}

/** Problems of one kind, in one kind of place, together: «rows 3, 4, 5 and 12 more have no name». */
export interface ProblemGroup {
  /** 'line' (a spreadsheet row), 'electors' or 'units' (a line of a .padron), or the place as it came, such as 'file'. */
  place: string;
  problem: string;
  /** The row or line numbers, in the order they came. Empty for a place without lines. */
  lines: number[];
}

export function groupProblems(problems: readonly PadronProblem[]): ProblemGroup[] {
  const groups = new Map<string, ProblemGroup>();
  for (const { where, problem } of problems) {
    const numbered = /^(?:(line) |(electors|units):)(\d+)$/.exec(where);
    const place = numbered ? (numbered[1] ?? numbered[2]!) : where;
    const key = `${place}\n${problem}`;
    let group = groups.get(key);
    if (!group) groups.set(key, (group = { place, problem, lines: [] }));
    if (numbered) group.lines.push(Number(numbered[3]));
  }
  return [...groups.values()];
}
