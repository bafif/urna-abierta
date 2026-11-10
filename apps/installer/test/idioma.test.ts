import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { preferences, remember, savedLanguage, systemLanguage } from '../src/preferences.ts';
import { installerLanguageOf, installerTexts } from './texts.ts';

const texts = installerTexts();
const ui = readFileSync(new URL('../ui/app.js', import.meta.url), 'utf8');
/** The values a text fills in, like {name}: a translation has to fill the same ones. */
const filled = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

describe('the texts of the installer', () => {
  it('has every key in both languages, none of them empty, and each fills the same values', () => {
    expect(Object.keys(texts.en).sort()).toEqual(Object.keys(texts.es).sort());
    for (const [key, text] of Object.entries(texts.es)) {
      expect(text.trim(), `es ${key}`).not.toBe('');
      expect(texts.en[key]!.trim(), `en ${key}`).not.toBe('');
      expect(filled(texts.en[key]!), key).toEqual(filled(text));
    }
  });

  it('has every key the screens name, and the screens write no Spanish of their own', () => {
    const named = [...ui.matchAll(/\bt\('([\w.]+)'/g), ...ui.matchAll(/\bkey: '([\w.]+)'/g)].map((match) => match[1]!);
    expect(named.length).toBeGreaterThan(50);
    expect(named.filter((key) => !(key in texts.es))).toEqual([]);
    const spanish = ui
      .split('\n')
      .map((line) => line.replace(/(^|\s)\/\/.*$/, ''))
      // The invented names of the theme preview are the same in both languages.
      .filter((line) => !line.includes('const SAMPLE') && /[áéíóúñÁÉÍÓÚÑ¿¡]/.test(line));
    expect(spanish).toEqual([]);
  });
});

describe('the language of the installer', () => {
  const dir = mkdtempSync(join(tmpdir(), 'urna-idioma-'));
  const before = process.env.URNA_CONFIG_DIR;
  beforeEach(() => {
    process.env.URNA_CONFIG_DIR = join(dir, String(Math.random()));
  });
  afterEach(() => {
    process.env.URNA_CONFIG_DIR = before;
  });

  it('is Spanish on the screens when any language the browser prefers is Spanish, and English otherwise', () => {
    const languageOf = installerLanguageOf();
    expect(languageOf(['es-AR'])).toBe('es');
    expect(languageOf(['en-US', 'es'])).toBe('es');
    expect(languageOf(['es-419'])).toBe('es');
    expect(languageOf(['en-GB', 'pt-BR'])).toBe('en');
    expect(languageOf([''])).toBe('en');
  });

  it('is the one of the system for what it says before the screens, also where only Intl knows it', () => {
    expect(systemLanguage({ LANG: 'es_AR.UTF-8' }, 'en-US')).toBe('es');
    expect(systemLanguage({ LANG: 'en_US.UTF-8' }, 'es-AR')).toBe('en');
    expect(systemLanguage({ LC_ALL: 'es_ES.UTF-8', LANG: 'en_US.UTF-8' }, 'en-US')).toBe('es');
    expect(systemLanguage({ LC_MESSAGES: 'en_US.UTF-8', LANG: 'es_AR.UTF-8' }, 'es-AR')).toBe('en');
    expect(systemLanguage({ LANG: 'en_US.UTF-8', LANGUAGE: 'en_US:es' }, 'en-US')).toBe('es');
    // Windows, or a terminal without a language: the account's, through Intl.
    expect(systemLanguage({}, 'es-AR')).toBe('es');
    expect(systemLanguage({ LANG: 'C.UTF-8' }, 'es-419')).toBe('es');
    expect(systemLanguage({}, 'en-US')).toBe('en');
  });

  it('remembers what the person chose, next to the other preferences', () => {
    expect(savedLanguage()).toBeNull();
    remember({ vision: 'local' });
    remember({ language: 'en' });
    expect(savedLanguage()).toBe('en');
    expect(preferences()).toEqual({ vision: 'local', language: 'en' });
    remember({ vision: 'later' });
    expect(preferences()).toEqual({ vision: 'later', language: 'en' });
  });

  it('takes nothing but a language from the file', () => {
    remember({ language: 'pt' as 'es' });
    expect(savedLanguage()).toBeNull();
    rmSync(dir, { recursive: true, force: true });
  });
});
