import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import * as v from 'valibot';

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

function readLines<T>(file: string, content: string, schema: v.GenericSchema<unknown, T>, problems: PadronProblem[]): T[] {
  const rows: T[] = [];
  splitLines(content).forEach((line, index) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      problems.push({ where: `${file}:${index + 1}`, problem: 'not_json' });
      return;
    }
    const result = v.safeParse(schema, parsed);
    if (result.success) rows.push(result.output);
    else problems.push({ where: `${file}:${index + 1}`, problem: `invalid:${result.issues[0]?.path?.[0]?.key ?? 'row'}` });
  });
  return rows;
}

/** Reads and checks a .padron file. An unknown major version is refused; unknown fields are ignored. */
export function readPadron(bytes: Uint8Array): PadronRead {
  const problems: PadronProblem[] = [];
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    return { padron: null, problems: [{ where: 'file', problem: 'not_a_zip' }] };
  }
  const manifestFile = files['manifest.json'];
  if (!manifestFile) return { padron: null, problems: [{ where: 'file', problem: 'missing_manifest' }] };
  let rawManifest: unknown;
  try {
    rawManifest = JSON.parse(strFromU8(manifestFile));
  } catch {
    return { padron: null, problems: [{ where: 'manifest.json', problem: 'not_json' }] };
  }
  const parsedManifest = v.safeParse(manifestSchema, rawManifest);
  if (!parsedManifest.success) return { padron: null, problems: [{ where: 'manifest.json', problem: 'invalid' }] };
  const manifest = parsedManifest.output;
  if (Number(manifest.format_version.split('.')[0]) !== PADRON_MAJOR) {
    return { padron: null, problems: [{ where: 'manifest.json', problem: 'unsupported_version' }] };
  }
  const electorsFile = files[manifest.files.electors.path];
  if (!electorsFile) return { padron: null, problems: [{ where: manifest.files.electors.path, problem: 'missing_file' }] };
  const unitsFile = manifest.files.units ? files[manifest.files.units.path] : undefined;
  const units = unitsFile ? readLines('units', strFromU8(unitsFile), unitSchema, problems) : [];
  const electors = readLines('electors', strFromU8(electorsFile), electorSchema, problems);
  if (electors.length + problems.filter((p) => p.where.startsWith('electors')).length !== manifest.files.electors.count) {
    problems.push({ where: 'manifest.json', problem: 'count_mismatch' });
  }
  const seen = new Set<string>();
  const unitIds = new Set(units.map((unit) => unit.id));
  electors.forEach((elector, index) => {
    if (seen.has(elector.id)) problems.push({ where: `electors:${index + 1}`, problem: 'repeated_id' });
    seen.add(elector.id);
    if (elector.table && unitIds.size > 0 && !unitIds.has(elector.table)) {
      problems.push({ where: `electors:${index + 1}`, problem: 'unknown_table' });
    }
  });
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

const HEADERS: Record<string, readonly string[]> = {
  full_name: ['nombre completo', 'apellido y nombre', 'apellido y nombres', 'nombre y apellido', 'nombre', 'full_name', 'name'],
  family: ['apellido', 'apellidos', 'family_name'],
  given: ['nombres', 'given_names'],
  document: ['dni', 'documento', 'nro documento', 'document'],
  file_number: ['legajo'],
  order: ['orden', 'numero', 'número', 'nº', 'nro', 'order'],
  table: ['mesa', 'table'],
  address: ['domicilio', 'direccion', 'dirección', 'address'],
};

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

/** A simple spreadsheet is enough to use the app without the scanner. */
export function readCsvRoll(content: string): PadronRead {
  const lines = content.replace(/^﻿/, '').split(/\r?\n/).filter((line) => line.trim() !== '');
  const first = lines[0];
  if (!first) return { padron: null, problems: [{ where: 'file', problem: 'empty' }] };
  const separator = [';', ',', '\t'].sort((a, b) => first.split(b).length - first.split(a).length)[0]!;
  const headers = splitCsvLine(first, separator).map((header) => header.toLowerCase());
  const column = (name: string) => headers.findIndex((header) => HEADERS[name]!.includes(header));
  const columns = Object.fromEntries(Object.keys(HEADERS).map((name) => [name, column(name)]));
  if (columns.full_name! < 0 && columns.family! < 0) return { padron: null, problems: [{ where: 'line 1', problem: 'no_name_column' }] };
  const problems: PadronProblem[] = [];
  const electors: PadronElector[] = [];
  lines.slice(1).forEach((line, index) => {
    const cells = splitCsvLine(line, separator);
    const cell = (name: string) => { const at = columns[name]!; return at >= 0 ? cells[at] || undefined : undefined; };
    const family = cell('family');
    const given = cell('given');
    const fullName = cell('full_name') ?? [family, given].filter(Boolean).join(', ');
    if (!fullName) { problems.push({ where: `line ${index + 2}`, problem: 'no_name' }); return; }
    const document = cell('document')?.replace(/\D/g, '');
    const fileNumber = cell('file_number');
    const order = Number(cell('order'));
    electors.push({
      id: document ? `d-${document}` : `f-${index + 1}`,
      full_name: fullName,
      table: cell('table') ?? null,
      order: Number.isInteger(order) && order > 0 ? order : null,
      address: cell('address') ?? null,
      identifiers: [...(document ? [{ type: 'DNI', value: document }] : []), ...(fileNumber ? [{ type: 'legajo', value: fileNumber }] : [])],
      review: { status: 'ok' },
    });
  });
  return {
    padron: { manifest: { format: PADRON_FORMAT, format_version: '0.1.0', files: { electors: { path: 'csv', count: electors.length } } }, units: [], electors },
    problems,
  };
}
