import type { MessageKey } from './i18n.svelte.ts';

/** What the server holds about one person, as it sends it for the page that is handed to them. */
export interface PersonData {
  party: string;
  election: { name: string; days: string[] };
  person: { name: string; document: string | null; fileNumber: string | null; address: string | null; order: number | null; extra: Record<string, unknown>; toReview: boolean };
  table: { name: string; place: string } | null;
  consent: { date: string; means: string } | null;
  semaphore: { category: string | null; sensitive: boolean; hidden: boolean; notedAt: string } | null;
  markedVoted: string[];
}

type Say = (key: MessageKey, values?: Record<string, string | number>) => string;

const escape = (value: unknown) =>
  String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

/** A name a file can have: «datos-ana-gomez.html». */
export function personDataFile(name: string): string {
  const slug = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  return `datos-${slug || 'persona'}.html`;
}

/**
 * Everything held about a person, as a page anyone can read and print: plain words, no codes and no internal fields,
 * as arts. 14 and 15 of Ley 25.326 ask. It is built in the language of the screen, from what the server sent.
 */
export function personDataPage(data: PersonData, say: Say, language: string, now = new Date()): string {
  const when = (moment: string) => new Date(moment).toLocaleString(language, { dateStyle: 'long', timeStyle: 'short' });
  const day = (value: string) => (/^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`).toLocaleDateString(language, { dateStyle: 'long' }) : value);
  const row = (label: string, value: unknown) => `<dt>${escape(label)}</dt><dd>${value === null || value === undefined || value === '' ? `<span class="falta">${escape(say('data.empty'))}</span>` : escape(value)}</dd>`;
  const section = (title: string, body: string) => `<h2>${escape(title)}</h2>${body}`;
  const paragraph = (text: string) => `<p>${escape(text)}</p>`;
  const { person, table, consent, semaphore } = data;
  const extra = Object.entries(person.extra ?? {}).filter(([, value]) => value !== null && value !== '');

  const roll = [
    `<dl>`,
    row(say('data.name'), person.name),
    row(say('data.document'), person.document),
    ...(person.fileNumber ? [row(say('data.fileNumber'), person.fileNumber)] : []),
    row(say('data.address'), person.address),
    ...extra.map(([key, value]) => row(key, typeof value === 'object' ? JSON.stringify(value) : value)),
    `</dl>`,
    person.toReview ? paragraph(say('data.toReview')) : '',
    `<p class="nota">${escape(say('data.roll.note'))}</p>`,
  ].join('');

  const where = table
    ? `<dl>${row(say('data.table'), table.name)}${row(say('data.place'), table.place)}${row(say('data.order'), person.order)}${row(say('data.days'), data.election.days.map(day).join(', '))}</dl>`
    : paragraph(say('data.noTable'));

  const voted = data.markedVoted.length > 0 ? paragraph(say('data.voted.yes', { when: data.markedVoted.map(when).join(', ') })) : paragraph(say('data.voted.no'));

  const light =
    paragraph(say('data.light.what')) +
    (!semaphore
      ? paragraph(say('data.light.none'))
      : semaphore.hidden
        ? paragraph(say('data.light.hidden'))
        : paragraph(say('data.light.category', { category: semaphore.category ?? '', when: when(semaphore.notedAt) })));

  const agreed = consent ? paragraph(say('data.consent.yes', { date: day(consent.date), means: consent.means })) : paragraph(say('data.consent.no'));

  const title = say('data.title', { name: person.name });
  return [
    `<!doctype html><html lang="${escape(language)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">`,
    `<title>${escape(title)}</title>`,
    '<style>body{font:17px/1.5 system-ui,sans-serif;color:#111;max-width:40em;margin:2em auto;padding:0 1em}h1{font-size:1.5em}h2{font-size:1.15em;margin-top:1.6em;border-bottom:1px solid #ccc}dl{display:grid;grid-template-columns:max-content 1fr;gap:.3em 1em}dt{font-weight:600}dd{margin:0}.nota,.falta,footer{color:#555}footer{margin-top:2em;font-size:.9em}</style>',
    `</head><body><h1>${escape(title)}</h1>`,
    paragraph(say('data.intro', { party: data.party || say('data.party'), election: data.election.name })),
    section(say('data.roll'), roll),
    section(say('data.where'), where),
    section(say('data.voted'), voted),
    section(say('data.light'), light),
    section(say('data.consent'), agreed),
    section(say('data.rights'), paragraph(say('data.rights.text'))),
    `<footer>${escape(say('data.made', { when: when(now.toISOString()) }))}</footer>`,
    '</body></html>',
  ].join('\n');
}
