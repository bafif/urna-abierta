import type { ExcelRoll } from './excel-roll.ts';

/**
 * An Excel roll as a .padron, read in a worker so that the page keeps answering while a big sheet takes seconds. The reader and
 * the zip code load only now, when a spreadsheet is chosen. Where there are no workers it runs here: the same, with the page waiting.
 */
export async function readExcelRoll(file: Blob): Promise<ExcelRoll> {
  const bytes = await file.arrayBuffer();
  let worker: Worker;
  try {
    worker = new Worker(new URL('./excel-roll.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    const { excelToPadron } = await import('./excel-roll.ts');
    return excelToPadron(new Uint8Array(bytes));
  }
  try {
    return await new Promise<ExcelRoll>((resolve, reject) => {
      worker.addEventListener('message', (event: MessageEvent<ExcelRoll>) => resolve(event.data));
      worker.addEventListener('messageerror', () => reject(new Error('excel_worker_failed')));
      worker.addEventListener('error', (event) => reject(new Error(event.message || 'excel_worker_failed')));
      worker.postMessage(bytes, [bytes]);
    });
  } finally {
    worker.terminate();
  }
}
