// What the page needs about a roll file without reading one. Apart from padron.ts, so that the page can show it without
// carrying the readers and the zip code, which load only when a spreadsheet is chosen.

/** The largest roll file the server takes. The browser checks it too, before reading a file. */
export const MAX_ROLL_BYTES = 64 * 1024 * 1024;

export interface PadronProblem {
  /** Where: a file and, when it applies, its line. Never the content of a row. */
  where: string;
  problem: string;
}

/** Where the roll reader for scanned PDFs is explained and downloaded from, in Spanish and in English. */
export const ROLL_READER_URL = 'https://github.com/bafif/urna-abierta-padrones#descargar';
export const ROLL_READER_URL_EN = 'https://github.com/bafif/urna-abierta-padrones/blob/main/README.en.md#download';

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
