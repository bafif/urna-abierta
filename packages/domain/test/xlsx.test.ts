import { describe, expect, it } from 'vitest';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { groupProblems, MAX_UNZIPPED_BYTES, readCsvRoll, readPadron, readXlsxRoll, writePadron } from '../src/index.ts';
import { declareSize } from './zip.ts';

/** A cell as Excel writes it: a shared string by its index, an inline string, or a number with its cell style (1 unless said). */
type Cell = { s: number } | { inline: string } | { n: string; style?: number } | null;

const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const column = (index: number) => String.fromCharCode(65 + index);

function sheetXml(rows: Record<number, Cell[]>): string {
  const body = Object.entries(rows)
    .map(([line, cells]) => {
      const xml = cells
        .map((cell, index) => {
          const ref = `${column(index)}${line}`;
          if (cell === null) return '';
          if ('s' in cell) return `<c r="${ref}" t="s"><v>${cell.s}</v></c>`;
          if ('inline' in cell) return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escape(cell.inline)}</t></is></c>`;
          return `<c r="${ref}" s="${cell.style ?? 1}"><v>${cell.n}</v></c>`;
        })
        .join('');
      return `<row r="${line}">${xml}</row>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:E9"/><cols><col min="1" max="1" width="30"/></cols><sheetData>${body}</sheetData></worksheet>`;
}

/** A minimal workbook, zipped the way Excel does it. The first sheet in the workbook can live in any file. */
function workbook({ strings = [], sheets, styles }: { strings?: string[]; sheets: { name: string; file: string; xml: string }[]; styles?: string }): Uint8Array {
  const rel = (id: string, type: string, target: string) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`;
  const relationships = (content: string) => `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${content}</Relationships>`;
  const sheetList = sheets.map((sheet, index) => `<sheet name="${sheet.name}" sheetId="${index + 1}" r:id="rIdS${index}"/>`).join('');
  const item = (text: string) => (text.startsWith('<') ? `<si>${text}</si>` : `<si><t>${escape(text)}</t></si>`);
  return zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
    '_rels/.rels': strToU8(relationships(rel('rId1', 'officeDocument', 'xl/workbook.xml'))),
    'xl/workbook.xml': strToU8(`<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetList}</sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(relationships(sheets.map((sheet, index) => rel(`rIdS${index}`, 'worksheet', `worksheets/${sheet.file}`)).join('') + rel('rIdT', 'sharedStrings', 'sharedStrings.xml') + (styles ? rel('rIdY', 'styles', 'styles.xml') : ''))),
    'xl/sharedStrings.xml': strToU8(`<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}">${strings.map(item).join('')}</sst>`),
    ...(styles ? { 'xl/styles.xml': strToU8(styles) } : {}),
    ...Object.fromEntries(sheets.map((sheet) => [`xl/worksheets/${sheet.file}`, strToU8(sheet.xml)])),
  });
}

const oneSheet = (rows: Record<number, Cell[]>, strings: string[] = []) => workbook({ strings, sheets: [{ name: 'Hoja1', file: 'sheet1.xml', xml: sheetXml(rows) }] });

describe('Excel spreadsheets', () => {
  it('reads shared and inline strings, documents stored as numbers and empty cells', () => {
    const strings = ['Apellido y nombre', 'DNI', 'Mesa', 'Domicilio', 'Prueba, Ana', 'Calle Falsa 123'];
    const file = oneSheet(
      {
        1: [{ s: 0 }, { s: 1 }, { s: 2 }, { s: 3 }],
        2: [{ s: 4 }, { n: '99123456' }, { n: '3' }, { s: 5 }],
        3: [{ inline: 'Prueba, Luis' }, { n: '9.9123457E7' }, null, null],
        4: [{ inline: 'Prueba, Eva' }, { n: '99123458.0' }, { n: '4' }],
        5: [{ inline: 'Prueba, Sol' }, null, { n: '4' }],
      },
      strings,
    );
    const { padron, problems } = readXlsxRoll(file);
    expect(problems).toEqual([]);
    expect(padron?.electors.map((elector) => elector.id)).toEqual(['d-99123456', 'd-99123457', 'd-99123458', 'f-4']);
    expect(padron?.electors[0]).toMatchObject({ full_name: 'Prueba, Ana', table: '3', address: 'Calle Falsa 123', identifiers: [{ type: 'DNI', value: '99123456' }] });
    expect(padron?.electors[1]).toMatchObject({ full_name: 'Prueba, Luis', table: null, address: null, identifiers: [{ type: 'DNI', value: '99123457' }] });
    expect(padron?.electors[3]?.identifiers).toEqual([]);
  });

  it('finds the header below a title, and names rows by the number the spreadsheet shows', () => {
    const file = oneSheet({
      1: [{ inline: 'Padrón de prueba 2027' }],
      2: [{ inline: 'Agrupación Ejemplo' }, null, { inline: 'Hoja 1' }],
      4: [{ inline: 'Orden' }, { inline: 'Apellido' }, { inline: 'Nombres' }, { inline: 'Legajo' }],
      5: [{ n: '1' }, { inline: 'Prueba' }, { inline: 'Ana' }, { inline: 'A-1/2' }],
      6: [{ n: '2' }, null, null, { inline: 'A-1/3' }],
      7: [{ n: '3' }, { inline: 'Prueba' }, { inline: 'Luis' }],
    });
    const { padron, problems } = readXlsxRoll(file);
    expect(padron?.electors.map((elector) => [elector.id, elector.full_name, elector.order])).toEqual([
      ['l-A-1/2', 'Prueba, Ana', 1],
      ['f-3', 'Prueba, Luis', 3],
    ]);
    expect(padron?.electors[0]?.identifiers).toEqual([{ type: 'legajo', value: 'A-1/2' }]);
    expect(problems).toEqual([{ where: 'line 6', problem: 'no_name' }]);
  });

  it('gives the same people and ids as the same table in a CSV', () => {
    const file = oneSheet({
      1: [{ inline: 'nombre' }, { inline: 'dni' }, { inline: 'mesa' }],
      2: [{ inline: 'Prueba, Ana' }, { n: '99000001' }, { n: '1' }],
      3: [{ inline: 'Prueba, Luis' }, null, { n: '2' }],
    });
    // Excel writes the empty rows inside a sheet as lines of separators.
    const csv = readCsvRoll('nombre,dni,mesa\n"Prueba, Ana",99.000.001,1\n,,\n"Prueba, Luis",,2\n,,\n');
    expect(csv.problems).toEqual([]);
    expect(readXlsxRoll(file).padron?.electors).toEqual(csv.padron?.electors);
  });

  it('keeps the text of rich text, escaped characters and accents, without phonetic guides', () => {
    const rich = '<r><rPr><b/></rPr><t>Prueba, </t></r><r><t xml:space="preserve">Ana María</t></r><rPh sb="0" eb="1"><t>X</t></rPh>';
    const file = oneSheet({ 1: [{ s: 0 }], 2: [{ s: 1 }], 3: [{ s: 2 }] }, ['Nombre', rich, '<t>O&apos;Prueba &amp; N&#250;&#xF1;ez, Luis_x000D_</t>']);
    expect(readXlsxRoll(file).padron?.electors.map((elector) => elector.full_name)).toEqual(['Prueba, Ana María', "O'Prueba & Núñez, Luis"]);
  });

  it('reads the first sheet of the workbook, whatever file it is in', () => {
    const first = sheetXml({ 1: [{ inline: 'Nombre' }], 2: [{ inline: 'Prueba, Primera' }] });
    const second = sheetXml({ 1: [{ inline: 'Nombre' }], 2: [{ inline: 'Prueba, Segunda' }] });
    const file = workbook({ sheets: [{ name: 'Padrón', file: 'sheet2.xml', xml: first }, { name: 'Otra', file: 'sheet1.xml', xml: second }] });
    expect(readXlsxRoll(file).padron?.electors.map((elector) => elector.full_name)).toEqual(['Prueba, Primera']);
  });

  it('understands cells with a namespace prefix, formulas and errors', () => {
    const xml = `<x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData>
      <x:row r="1"><x:c r="A1" t="inlineStr"><x:is><x:t>Nombre</x:t></x:is></x:c><x:c r="B1" t="inlineStr"><x:is><x:t>DNI</x:t></x:is></x:c><x:c r="C1" t="inlineStr"><x:is><x:t>Mesa</x:t></x:is></x:c></x:row>
      <x:row r="2"><x:c r="A2" t="str"><x:f>"Prueba, "&amp;"Ana"</x:f><x:v>Prueba, Ana</x:v></x:c><x:c r="B2"><x:v>99000002</x:v></x:c><x:c r="C2" t="e"><x:v>#N/A</x:v></x:c></x:row>
    </x:sheetData></x:worksheet>`;
    const file = workbook({ sheets: [{ name: 'Hoja1', file: 'sheet1.xml', xml }] });
    expect(readXlsxRoll(file).padron?.electors[0]).toMatchObject({ id: 'd-99000002', full_name: 'Prueba, Ana', table: null });
  });

  it('points out a person who comes twice, and keeps the first one', () => {
    const file = oneSheet({
      1: [{ inline: 'Nombre' }, { inline: 'DNI' }],
      2: [{ inline: 'Prueba, Ana' }, { n: '99000003' }],
      3: [{ inline: 'Prueba, Ana' }, { n: '99000003' }],
    });
    const { padron, problems } = readXlsxRoll(file);
    expect(padron?.electors).toHaveLength(1);
    expect(problems).toEqual([{ where: 'line 3', problem: 'same_person' }]);
  });

  it('keeps another name with the same document as one more person, both for review, as a CSV does', () => {
    const file = oneSheet({
      1: [{ inline: 'Nombre' }, { inline: 'DNI' }, { inline: 'Legajo' }],
      2: [{ inline: 'Prueba, Ana' }, { n: '99000004' }, { inline: 'A-1/1' }],
      3: [{ inline: 'Ejemplo, Luis' }, { n: '99000004' }, { inline: 'A-2/2' }],
      4: [{ inline: 'Muestra, Sol' }, { n: '9.9000004E7' }],
      5: [{ inline: 'PRUEBA ANA' }, { n: '99000004' }, { inline: 'A-3/3' }],
    });
    const read = readXlsxRoll(file);
    expect(read.padron?.electors.map((elector) => [elector.id, elector.full_name, elector.review?.status])).toEqual([
      ['d-99000004', 'Prueba, Ana', 'pending'],
      ['l-A-2/2', 'Ejemplo, Luis', 'pending'],
      ['f-3', 'Muestra, Sol', 'pending'],
    ]);
    expect(read.problems).toEqual([
      { where: 'line 2', problem: 'same_document_other_name' },
      { where: 'line 3', problem: 'same_document_other_name' },
      { where: 'line 4', problem: 'same_document_other_name' },
      { where: 'line 5', problem: 'same_person' },
    ]);
    expect(readXlsxRoll(file)).toEqual(read);
    const csv = readCsvRoll('Nombre,DNI,Legajo\n"Prueba, Ana",99000004,A-1/1\n"Ejemplo, Luis",99000004,A-2/2\n"Muestra, Sol",99000004,\nPRUEBA ANA,99000004,A-3/3\n');
    expect(csv).toEqual({ ...read, padron: { ...read.padron, manifest: { ...read.padron!.manifest, files: { electors: { path: 'csv', count: 3 } } } } });
  });

  it('says what is wrong without showing any row', () => {
    expect(readXlsxRoll(strToU8('esto no es una planilla')).problems).toEqual([{ where: 'file', problem: 'not_a_spreadsheet' }]);
    expect(readXlsxRoll(zipSync({ 'otro.txt': strToU8('x') })).problems).toEqual([{ where: 'file', problem: 'not_a_spreadsheet' }]);
    expect(readXlsxRoll(oneSheet({})).problems).toEqual([{ where: 'file', problem: 'empty' }]);
    const noName = readXlsxRoll(oneSheet({ 2: [{ inline: 'DNI' }, { inline: 'Mesa' }], 3: [{ inline: 'Prueba, Ana' }, { n: '1' }] }));
    expect(noName).toEqual({ padron: null, problems: [{ where: 'line 2', problem: 'no_name_column' }] });
    expect(JSON.stringify(noName)).not.toContain('Prueba');
  });

  it('becomes a .padron that the server reads without problems', () => {
    const rows: Record<number, Cell[]> = { 1: [{ inline: 'Apellido' }, { inline: 'Nombres' }, { inline: 'DNI' }, { inline: 'Mesa' }] };
    for (let i = 0; i < 300; i += 1) rows[i + 2] = [{ inline: 'Prueba' }, { inline: `Persona ${i}` }, { n: String(99_100_000 + i) }, { n: String(1 + (i % 3)) }];
    const read = readXlsxRoll(oneSheet(rows));
    expect(read.padron?.electors).toHaveLength(300);
    const back = readPadron(writePadron({ electors: read.padron!.electors }));
    expect(back.problems).toEqual([]);
    expect(back.padron?.electors).toEqual(read.padron?.electors);
  });

  it('keeps the zeros that a format of zeros alone shows, and leaves other formats alone', () => {
    const styles = `<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <numFmts count="3"><numFmt numFmtId="164" formatCode="000000"/><numFmt numFmtId="165" formatCode="0.00"/><numFmt numFmtId="166" formatCode="000"/></numFmts>
      <cellStyleXfs count="1"><xf numFmtId="164"/></cellStyleXfs>
      <cellXfs count="5"><xf numFmtId="0" fontId="0"/><xf numFmtId="1"/><xf numFmtId="164" applyNumberFormat="1"><alignment horizontal="left"/></xf><xf numFmtId="165"/><xf numFmtId="166"/></cellXfs></styleSheet>`;
    const rows: Record<number, Cell[]> = {
      1: [{ inline: 'Nombre' }, { inline: 'Legajo' }, { inline: 'Mesa' }, { inline: 'DNI' }, { inline: 'Orden' }],
      2: [{ inline: 'Prueba, Ana' }, { n: '1234', style: 2 }, { n: '7', style: 4 }, { n: '99000001', style: 3 }, { n: '5', style: 0 }],
    };
    const file = workbook({ sheets: [{ name: 'Hoja1', file: 'sheet1.xml', xml: sheetXml(rows) }], styles });
    const csv = readCsvRoll('Nombre,Legajo,Mesa,DNI,Orden\n"Prueba, Ana",001234,007,99000001,5\n');
    expect(readXlsxRoll(file).padron?.electors).toEqual(csv.padron?.electors);
    expect(csv.padron?.electors[0]).toMatchObject({ table: '007', order: 5, identifiers: [{ type: 'DNI', value: '99000001' }, { type: 'legajo', value: '001234' }] });
  });

  it('refuses a workbook whose sheet would take too much once unpacked, and ignores the parts it never reads', () => {
    const file = oneSheet({ 1: [{ inline: 'Nombre' }], 2: [{ inline: 'Prueba, Ana' }] });
    expect(readXlsxRoll(declareSize(file, 'xl/worksheets/sheet1.xml', MAX_UNZIPPED_BYTES + 1)).problems).toEqual([{ where: 'file', problem: 'too_big' }]);
    expect(readXlsxRoll(declareSize(file, 'xl/sharedStrings.xml', MAX_UNZIPPED_BYTES + 1)).problems).toEqual([{ where: 'file', problem: 'too_big' }]);
    const withPicture = zipSync({ ...unzipSync(file), 'xl/media/image1.png': new Uint8Array(16) });
    expect(readXlsxRoll(declareSize(withPicture, 'xl/media/image1.png', MAX_UNZIPPED_BYTES + 1)).padron?.electors).toHaveLength(1);
  });

  it('takes the roll out of a follow-up sheet, and nothing else that sheet keeps', () => {
    // The shape of a sheet a group keeps for a student election: the roll, and its own columns next to it.
    const headers = ['N°', 'Nombre', 'Documento', 'Legajo', 'Carrera', 'Intención de voto', 'Instagram', 'Responsable', 'Observaciones', 'Ya votó', 'Contactado', 'Calidad', 'Teléfono', 'Agrupación anterior', 'Notas', 'Segunda vuelta', 'Fecha de contacto', 'Mesa habitual', 'Seguimiento', 'RECUENTO', 'Cantidad'];
    const careers = ['Ingeniería Inventada', 'Licenciatura de Prueba'];
    const kept: string[] = [...careers];
    const other = (value: string): Cell => {
      kept.push(value);
      return { inline: value };
    };
    const documents: Cell[] = [{ inline: '99000101' }, { inline: '99000102' }, { n: '99000103' }, { inline: '9900104' }, { inline: '99000105001' }, { n: '9.9000106E7' }, { inline: '99000107' }, { inline: '9900010800' }, { inline: '99000109' }, { n: '99000110.0' }, { inline: '99000111' }, { inline: '99000112' }];
    const rows: Record<number, Cell[]> = { 1: headers.map((header) => ({ inline: header })) };
    documents.forEach((document, i) => {
      rows[i + 2] = [
        { n: `${(i % 6) + 1}.0` },
        { inline: `Prueba, Persona ${i + 1}` },
        document,
        i % 4 === 3 ? null : { inline: `A-${5100 + i}/${i % 10}` },
        { inline: careers[Math.floor(i / 6)]! },
        other(i % 2 ? 'Intención inventada uno' : 'Intención inventada dos'),
        other(`https://www.instagram.com/prueba.privada.${i}`),
        other(`Responsable Inventada ${i % 3}`),
        other(`Observación privada ${i}`),
        other(i % 3 ? 'Votó temprano' : 'Todavía no votó'),
        other('Contactada por mensaje'),
        other(`Calidad inventada ${i % 4}`),
        other(`+54 9 000 000-00${String(i).padStart(2, '0')}`),
        other('Agrupación de Prueba'),
        other(`Nota de campaña ${i}`),
        other('Segunda vuelta inventada'),
        other(`Contacto del día ${i + 1}`),
        other(`Aula inventada ${i}`),
        other(`Seguimiento ${i}`),
        ...(i < 3 ? [other(['A favor', 'En contra', 'Sin dato'][i]!), { n: String(3 + i) }] : []),
      ];
    });
    // At the end, rows without a name that still carry the group's notes.
    for (let k = 0; k < 15; k += 1) {
      rows[14 + k] = [{ n: `${7 + k}.0` }, null, null, null, { inline: careers[1]! }, null, other(`https://www.instagram.com/prueba.sin.nombre.${k}`), null, null, null, other('Pendiente de llamar')];
    }

    const read = readXlsxRoll(oneSheet(rows));
    const electors = read.padron!.electors;
    expect(electors).toHaveLength(12);
    expect(electors.map((elector) => elector.order)).toEqual([1, 2, 3, 4, 5, 6, 1, 2, 3, 4, 5, 6]);
    expect(electors[0]).toEqual({ id: 'd-99000101', full_name: 'Prueba, Persona 1', table: null, order: 1, address: null, identifiers: [{ type: 'DNI', value: '99000101' }, { type: 'legajo', value: 'A-5100/0' }], review: { status: 'ok' } });
    expect(electors.map((elector) => elector.id)).toEqual(['d-99000101', 'd-99000102', 'd-99000103', 'd-9900104', 'l-A-5104/4', 'd-99000106', 'd-99000107', 'f-8', 'd-99000109', 'd-99000110', 'd-99000111', 'd-99000112']);
    // The rows without a name come once, together; the documents of another length, once too.
    expect(groupProblems(read.problems)).toEqual([
      { place: 'line', problem: 'odd_document', lines: [6, 9] },
      { place: 'line', problem: 'no_name', lines: Array.from({ length: 15 }, (_, k) => 14 + k) },
    ]);
    const inside = Object.values(unzipSync(writePadron({ electors }))).map((part) => strFromU8(part)).join('\n');
    for (const value of kept) expect(inside).not.toContain(value);
    for (const elector of electors) expect(Object.keys(elector).sort()).toEqual(['address', 'full_name', 'id', 'identifiers', 'order', 'review', 'table']);
  });
});
