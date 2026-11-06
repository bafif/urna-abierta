import { readXlsxRoll, writePadron, type PadronProblem } from '@urna-abierta/domain';

/** What an Excel roll becomes: the .padron the server gets, or null when there is nobody to load, and what to point out. */
export interface ExcelRoll {
  padron: Uint8Array | null;
  problems: PadronProblem[];
}

/** An .xlsx as a .padron, so the server only ever gets a .padron or a CSV. A big sheet takes seconds: it runs in a worker. */
export function excelToPadron(bytes: Uint8Array): ExcelRoll {
  const read = readXlsxRoll(bytes);
  return { padron: read.padron ? writePadron({ electors: read.padron.electors }) : null, problems: read.problems };
}
