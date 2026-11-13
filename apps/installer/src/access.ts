import { crc32 } from 'node:zlib';

/** What the person needs later, to get into the server: it all goes in the access file. */
export interface Access {
  /** The address of the app, empty while a pasted server has none yet. */
  address: string;
  setupLink: string;
  recoveryKey: string;
  user: string;
  /** As `ssh` shows it, when the installer connected itself. */
  fingerprint?: string;
  key: string;
}

const PLACEHOLDER = { es: 'LA-DIRECCIÓN-DE-TU-SERVIDOR', en: 'YOUR-SERVER-ADDRESS' };

/** The instructions, in the installer's language, for Windows, macOS and Linux alike. */
export function readme(access: Access, language: 'es' | 'en'): string {
  const host = access.address.replace(/^https?:\/\//, '').replace(/[/:].*$/, '') || PLACEHOLDER[language];
  const login = `ssh -i urna-abierta.key ${access.user}@${host}`;
  const lines = language === 'es'
    ? [
        'URNA ABIERTA · ACCESO A TU SERVIDOR',
        'Guardalo en un pendrive o en un gestor de contraseñas. No lo mandes por chat: con esto se entra a tu servidor.',
        '',
        `Dirección: ${access.address || PLACEHOLDER.es}`,
        ...(access.setupLink ? [`Link para crear tu cuenta: ${access.setupLink} (sirve una sola vez)`] : []),
        `Llave de recuperación: ${access.recoveryKey} (abre tus copias de seguridad)`,
        '',
        'CÓMO ENTRAR AL SERVIDOR',
        `Usuario: ${access.user}`,
        ...(access.fingerprint ? [`Huella: ${access.fingerprint}`] : []),
        '1. La llave para entrar está al lado de este archivo: urna-abierta.key. No la compartas.',
        '2. En Windows abrí PowerShell; en macOS o Linux, la Terminal. Andá a la carpeta de estos archivos y escribí:',
        `   ${login}`,
        '   En macOS y Linux, la primera vez escribí antes: chmod 600 urna-abierta.key',
        '3. Adentro: sudo urna estado · sudo urna actualizar · sudo urna restaurar',
        '4. Si nadie de coordinación puede entrar a la app: sudo urna invitar "tu nombre" da una invitación nueva y cierra los otros accesos.',
      ]
    : [
        'URNA ABIERTA · ACCESS TO YOUR SERVER',
        'Keep it on a USB stick or in a password manager. Do not send it over chat: this gets into your server.',
        '',
        `Address: ${access.address || PLACEHOLDER.en}`,
        ...(access.setupLink ? [`Link to create your account: ${access.setupLink} (works once)`] : []),
        `Recovery key: ${access.recoveryKey} (opens your backups)`,
        '',
        'HOW TO GET INTO THE SERVER',
        `User: ${access.user}`,
        ...(access.fingerprint ? [`Fingerprint: ${access.fingerprint}`] : []),
        '1. The key to get in is next to this file: urna-abierta.key. Do not share it.',
        '2. On Windows open PowerShell; on macOS or Linux, the Terminal. Go to the folder of these files and type:',
        `   ${login}`,
        '   On macOS and Linux, the first time type this before: chmod 600 urna-abierta.key',
        '3. Inside: sudo urna estado · sudo urna actualizar · sudo urna restaurar',
        '4. If nobody in coordination can get into the app: sudo urna invitar "your name" gives a new invitation and closes the other accesses.',
      ];
  // Windows' Notepad also reads plain line ends, but older ones did not.
  return `${lines.join('\r\n')}\r\n`;
}

/**
 * A zip without compression: two small text files, which every system opens without installing anything. The key
 * keeps owner-only permissions where the system that unpacks it honours them.
 */
export function zip(files: { name: string; text: string; secret?: boolean }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const data = Buffer.from(file.text, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    // Midnight of 1 January 1980, the first day a zip can say: no date is better than a made-up one.
    local.writeUInt32LE(0x00210000, 10);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    // Made on Unix, so that the permissions below count.
    central.writeUInt16LE((3 << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(0x00210000, 12);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(((file.secret ? 0o100600 : 0o100644) << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, data);
    centrals.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

export function accessFile(access: Access, language: 'es' | 'en'): Buffer {
  return zip([
    { name: language === 'es' ? 'LEEME.txt' : 'README.txt', text: readme(access, language) },
    { name: 'urna-abierta.key', text: access.key, secret: true },
  ]);
}
