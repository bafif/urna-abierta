import { describe, expect, it } from 'vitest';
import { personDataFile, personDataPage, type PersonData } from '../src/lib/person-data.ts';

/** Says each message by its key and values, so that the page can be checked without the dictionaries. */
const say = (key: string, values: Record<string, string | number> = {}) => `[${key}${Object.entries(values).map(([name, value]) => ` ${name}=${value}`).join('')}]`;

const data: PersonData = {
  party: 'Agrupación <Ejemplo>',
  election: { name: 'Centro de estudiantes', days: ['2027-04-06'] },
  person: { name: 'Gómez, Ana', document: '99111222', fileNumber: null, address: null, order: 12, extra: { carrera: 'Letras' }, toReview: false },
  table: { name: 'Mesa 3', place: 'Escuela Normal 1' },
  consent: { date: '2027-01-01', means: 'firma' },
  semaphore: { category: null, sensitive: true, hidden: true, notedAt: '2027-03-01T15:00:00.000Z' },
  markedVoted: ['2027-04-06T13:00:00.000Z'],
};

describe('the page with what is held about a person', () => {
  it('says each thing in words, with nothing internal and nothing that can run', () => {
    const page = personDataPage(data, say as never, 'es');
    expect(page).toMatch(/^<!doctype html><html lang="es">/);
    for (const key of ['data.title name=Gómez, Ana', 'data.roll', 'data.where', 'data.voted.yes', 'data.light.hidden', 'data.consent.yes', 'means=firma', 'data.rights.text']) expect(page).toContain(key);
    expect(page).toContain('Agrupación &lt;Ejemplo&gt;');
    expect(page).not.toContain('<Ejemplo>');
    expect(page).toContain('<dt>carrera</dt><dd>Letras</dd>');
    expect(page).toContain('99111222');
    expect(page).not.toMatch(/<script|election_id|needs_review|"review"/);
  });

  it('shows a category only when it came opened, and says plainly when there is nothing', () => {
    const opened = personDataPage({ ...data, semaphore: { category: 'Puede ser', sensitive: false, hidden: false, notedAt: '2027-03-01T15:00:00.000Z' } }, say as never, 'en');
    expect(opened).toContain('category=Puede ser');
    const empty = personDataPage({ ...data, table: null, consent: null, semaphore: null, markedVoted: [] }, say as never, 'en');
    for (const key of ['data.noTable', 'data.consent.no', 'data.light.none', 'data.voted.no', 'data.empty']) expect(empty).toContain(key);
    expect(empty).not.toContain('data.others');
  });

  it('also names a plain category kept under a sensitive one, whether that one came opened or not', () => {
    const under = { ...data.semaphore!, under: 'Puede <ser>' };
    const hidden = personDataPage({ ...data, semaphore: under }, say as never, 'es');
    expect(hidden).toContain('data.light.hidden');
    expect(hidden).toContain('[data.light.under category=Puede &lt;ser&gt;]');
    const opened = personDataPage({ ...data, semaphore: { ...under, category: 'Milita', hidden: false } }, say as never, 'es');
    expect(opened).toContain('category=Milita');
    expect(opened).toContain('[data.light.under category=Puede &lt;ser&gt;]');
    expect(personDataPage(data, say as never, 'es')).not.toContain('data.light.under');
  });

  it('says that it is about one roll, and names the others where the same document is', () => {
    const page = personDataPage({ ...data, others: ['Claustro', 'Consejo <Superior>'] }, say as never, 'es');
    expect(page).toContain('[data.intro party=Agrupación &lt;Ejemplo&gt; election=Centro de estudiantes]');
    expect(page).toContain('[data.others elections=«Claustro», «Consejo &lt;Superior&gt;»]');
  });

  it('names the file after the person, without accents or anything a file name cannot have', () => {
    expect(personDataFile('Gómez, Ana María')).toBe('datos-gomez-ana-maria.html');
    expect(personDataFile('')).toBe('datos-persona.html');
  });
});
