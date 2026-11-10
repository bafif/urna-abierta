import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** What the person chose here, kept for the next time: how to read the rolls, and the language of the screens. */
export interface Preferences {
  vision?: string;
  language?: 'es' | 'en';
}

const folder = () => process.env.URNA_CONFIG_DIR ?? join(homedir(), '.urna-abierta');

export function preferences(): Preferences {
  try {
    const saved = JSON.parse(readFileSync(join(folder(), 'preferencias.json'), 'utf8'));
    return saved && typeof saved === 'object' ? saved : {};
  } catch {
    return {};
  }
}

/** Adds to what was kept. Only preferences: if they cannot be written, they are asked again. */
export function remember(changes: Preferences): void {
  try {
    mkdirSync(folder(), { recursive: true, mode: 0o700 });
    writeFileSync(join(folder(), 'preferencias.json'), JSON.stringify({ ...preferences(), ...changes }), { mode: 0o600 });
  } catch {
    // Asked again next time.
  }
}

/** The language chosen in the installer before, if any. */
export function savedLanguage(): 'es' | 'en' | null {
  const { language } = preferences();
  return language === 'es' || language === 'en' ? language : null;
}

/**
 * The language of this computer, for what the installer says before its screens open. Spanish when the system is in
 * Spanish, as LC_ALL, LC_MESSAGES, LANG or LANGUAGE say on Linux and macOS; where they are not set, as on Windows,
 * Intl knows the language of the person's account.
 */
export function systemLanguage(env: NodeJS.ProcessEnv = process.env, fallback = Intl.DateTimeFormat().resolvedOptions().locale): 'es' | 'en' {
  const set = (value: string | undefined) => Boolean(value) && !/^(C|POSIX)([._@]|$)/.test(value!);
  const locale = [env.LC_ALL, env.LC_MESSAGES, env.LANG].find(set) ?? fallback;
  const preferred = [...(set(locale) ? (env.LANGUAGE ?? '').split(':') : []), locale];
  return preferred.some((tag) => tag.toLowerCase().split(/[-_.]/)[0] === 'es') ? 'es' : 'en';
}
