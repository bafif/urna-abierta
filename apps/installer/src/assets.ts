import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

/**
 * Files the installer carries inside. Built, they are packed into the executable; in development
 * they are read from where they live, so that themes and server scripts exist in one place only.
 */
const here = (path: string) => new URL(path, import.meta.url);

const fontsDir = '../../web/src/lib/fuentes/';

function sources(): Record<string, URL> {
  const fonts = Object.fromEntries(readdirSync(here(fontsDir)).filter((name) => name.endsWith('.woff2')).map((name) => [`fuentes/${name}`, here(fontsDir + name)]));
  return {
    'index.html': here('../ui/index.html'),
    'app.js': here('../ui/app.js'),
    'instalador.css': here('../ui/instalador.css'),
    'tema.css': here('../../web/src/lib/tema.css'),
    'temas.js': here('../../web/src/lib/temas.js'),
    'aplicar-tema.js': here('../../web/src/lib/aplicar-tema.js'),
    urna: here('../../../deploy/server/urna'),
    'instalar.sh': here('../../../deploy/server/instalar.sh'),
    ...fonts,
  };
}

/** Node's single executable API, when running as one. */
function packed(): { getAsset(name: string): ArrayBuffer } | null {
  try {
    const sea = createRequire(import.meta.url)('node:sea') as { isSea(): boolean; getAsset(name: string): ArrayBuffer };
    return sea.isSea() ? sea : null;
  } catch {
    return null;
  }
}

export function asset(name: string): Buffer | null {
  const sea = packed();
  try {
    if (sea) return Buffer.from(sea.getAsset(name));
    const source = sources()[name];
    return source ? readFileSync(source) : null;
  } catch {
    return null;
  }
}

export const assetText = (name: string) => asset(name)!.toString('utf8');

/** Everything to pack, for the build. */
export const assetFiles = () => Object.fromEntries(Object.entries(sources()).map(([name, url]) => [name, fileURLToPath(url)]));
