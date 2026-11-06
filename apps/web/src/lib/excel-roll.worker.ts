// Reads an Excel roll away from the page, so that a sheet of many thousand rows never freezes it.
import { excelToPadron } from './excel-roll.ts';

self.addEventListener('message', (event: MessageEvent<ArrayBuffer>) => {
  const roll = excelToPadron(new Uint8Array(event.data));
  self.postMessage(roll, { transfer: roll.padron ? [roll.padron.buffer as ArrayBuffer] : [] });
});
