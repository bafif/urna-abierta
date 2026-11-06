import { readFileSync } from 'node:fs';
import { readPadron, readXlsxRoll } from '@urna-abierta/domain';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { readExcelRoll } from '../src/lib/read-excel.ts';

/** The sheet the browser tests upload: twelve people, a row without a name and a second sheet with a note. */
const sheet = new Uint8Array(readFileSync(new URL('../e2e/padron-prueba.xlsx', import.meta.url)));

/**
 * A worker as a browser runs one: the worker script listens on its own scope, gets the bytes a while later, and what it posts
 * comes back to the page as a message. The script is the real one.
 */
class FakeWorker extends EventTarget {
  static last: FakeWorker | undefined;
  static script: ((event: MessageEvent) => void) | undefined;
  terminated = false;
  sent: Transferable[] = [];
  returned: Transferable[] = [];
  constructor(
    readonly url: URL,
    readonly options: WorkerOptions,
  ) {
    super();
    FakeWorker.last = this;
  }
  postMessage(data: ArrayBuffer, transfer: Transferable[]) {
    this.sent = transfer;
    setTimeout(() => FakeWorker.script!(new MessageEvent('message', { data })));
  }
  terminate() {
    this.terminated = true;
  }
}

beforeAll(async () => {
  vi.stubGlobal('self', {
    addEventListener: (_type: string, listener: (event: MessageEvent) => void) => (FakeWorker.script = listener),
    postMessage: (data: unknown, options: StructuredSerializeOptions) => {
      FakeWorker.last!.returned = options.transfer ?? [];
      FakeWorker.last!.dispatchEvent(new MessageEvent('message', { data }));
    },
  });
  await import('../src/lib/excel-roll.worker.ts');
});

afterEach(() => {
  vi.stubGlobal('Worker', undefined);
  FakeWorker.last = undefined;
});

/** What reading the sheet right here gives: the people the .padron has to carry and the problems to point out. */
const direct = readXlsxRoll(sheet);

describe('an Excel roll, read away from the page', () => {
  it('in a worker: the bytes go to it and the .padron comes back without copies, with the same people and problems', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const roll = await readExcelRoll(new Blob([sheet]));
    const worker = FakeWorker.last!;
    expect(worker.url.pathname).toMatch(/\/excel-roll\.worker\.ts$/);
    expect(worker.options).toEqual({ type: 'module' });
    expect(worker.sent).toHaveLength(1);
    expect(worker.returned).toEqual([roll.padron!.buffer]);
    expect(worker.terminated).toBe(true);
    expect(roll.problems).toEqual(direct.problems);
    expect(roll.problems.map((p) => p.problem)).toEqual(['other_sheets', 'no_name']);
    expect(readPadron(roll.padron!).padron?.electors).toEqual(direct.padron?.electors);
    expect(direct.padron?.electors).toHaveLength(12);
  });

  it('what is not a spreadsheet comes back as a problem about the whole file, with nothing to send', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const roll = await readExcelRoll(new Blob(['tampoco es una planilla']));
    expect(roll).toEqual({ padron: null, problems: [{ where: 'file', problem: 'not_a_spreadsheet' }] });
    expect(FakeWorker.last!.terminated).toBe(true);
  });

  it('a worker that fails is stopped, and the page hears it: nothing is sent', async () => {
    class FailingWorker extends FakeWorker {
      override postMessage() {
        setTimeout(() => this.dispatchEvent(Object.assign(new Event('error'), { message: 'out of memory' })));
      }
    }
    vi.stubGlobal('Worker', FailingWorker);
    await expect(readExcelRoll(new Blob([sheet]))).rejects.toThrow('out of memory');
    expect(FakeWorker.last!.terminated).toBe(true);
  });

  it('without workers, it reads here, with the same result', async () => {
    vi.stubGlobal('Worker', undefined);
    const roll = await readExcelRoll(new Blob([sheet]));
    expect(roll.problems).toEqual(direct.problems);
    expect(readPadron(roll.padron!).padron?.electors).toEqual(direct.padron?.electors);
  });
});
