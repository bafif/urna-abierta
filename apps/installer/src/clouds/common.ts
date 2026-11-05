export type Log = (line: string) => void;

/** A provider, as the installer sees it. The credentials live in memory and are gone when it closes. */
export interface Cloud {
  /** Reserves a fixed address, so that the server already knows it when it starts. */
  reserveAddress(log: Log): Promise<string>;
  /** Creates the machine, which runs the script on its first boot. */
  createServer(script: string, log: Log): Promise<void>;
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
