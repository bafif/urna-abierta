import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';
import { ageDecrypt, ageEncrypt, AgeError } from './age.ts';

/**
 * How «urna» encrypts a backup to the server's public key, and opens one with the recovery key. It runs in a container
 * of the server's image with no network, so the server needs no other program:
 *
 *   tar … | node apps/server/src/backup-key.ts cifrar age1…   > urna-20270406-063000.tar.age
 *   URNA_LLAVE=AGE-SECRET-KEY-1… node apps/server/src/backup-key.ts abrir < urna-….tar.age > copia.tar
 *
 * The recovery key goes in the environment, never as an argument: arguments are seen by every user of the machine.
 * Exit 2: that key does not open it. Exit 3: it is not a backup, or it is incomplete or changed.
 */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, recipient = ''] = process.argv.slice(2);
  try {
    if (command === 'cifrar') await pipeline(Readable.from(ageEncrypt(recipient, process.stdin)), process.stdout);
    else if (command === 'abrir') await pipeline(Readable.from(ageDecrypt(process.env.URNA_LLAVE ?? '', process.stdin)), process.stdout);
    else {
      console.error('uso: backup-key.ts cifrar <age1…> | abrir (con URNA_LLAVE)');
      process.exitCode = 64;
    }
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = error instanceof AgeError ? (error.kind === 'key' ? 2 : 3) : 1;
  }
}
