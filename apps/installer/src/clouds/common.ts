export type Log = (line: string) => void;

/** A provider, as the installer sees it. The credentials live in memory and are gone when it closes. */
export interface Cloud {
  /** Reserves a fixed address, so that the server already knows it when it starts. */
  reserveAddress(log: Log): Promise<string>;
  /** Creates the machine, which runs the script on its first boot. */
  createServer(script: string, log: Log): Promise<void>;
  /**
   * After a failure: deletes what this attempt created, newest first, so that nothing is left charging and
   * trying again does not add more. Returns what it could not delete, for the person to delete by hand.
   */
  cleanUp(log: Log): Promise<string[]>;
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** What one attempt has created so far, each with the way to undo it. */
export function createdResources() {
  const undo: { what: string; remove: () => Promise<void> }[] = [];
  return {
    add(what: string, remove: () => Promise<void>): void {
      undo.push({ what, remove });
    },
    async cleanUp(log: Log): Promise<string[]> {
      const left: string[] = [];
      if (undo.length) log('cleanup');
      // A resource may still be in use by the next one: the machine by the address, the network by the machine.
      while (undo.length) {
        const { what, remove } = undo.pop()!;
        try {
          await remove();
        } catch {
          left.push(what);
        }
      }
      return left;
    },
  };
}

/** Asks again until `done` says so, or gives up. */
export async function until(check: () => Promise<boolean>, wait: (ms: number) => Promise<void>, { tries = 60, every = 5_000, problem = 'timeout' } = {}): Promise<void> {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    if (await check()) return;
    await wait(every);
  }
  throw new Error(problem);
}
