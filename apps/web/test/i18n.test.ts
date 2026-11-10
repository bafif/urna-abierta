import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectLanguage, MESSAGES, type MessageKey } from '../src/lib/i18n.svelte.ts';

const SOURCE = new URL('../src', import.meta.url).pathname;

/** The values a text fills in, like {name}: a translation has to fill the same ones. */
const filled = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

/**
 * Files that may carry Spanish outside the texts of the app, and why: data, not interface. Anything else with letters
 * only Spanish uses is a text someone wrote by hand, which the English screen would show in Spanish.
 */
const NOT_INTERFACE: Record<string, string> = {
  'lib/i18n.svelte.ts': 'the texts themselves',
  'lib/temas.js': 'the idea of each theme, which is part of its file and is not shown',
  'lib/screens/ChooseTheme.svelte': 'the invented names of the preview, the same in both languages',
};

function files(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name);
    return entry.isDirectory() ? files(path) : /\.(svelte|ts|js)$/.test(entry.name) ? [path] : [];
  });
}

/** Each line without its comments: what is left is code or what a screen shows. */
function written(text: string): string[] {
  return text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/(^|\s)\/\/.*$/, ''));
}

describe('the texts of the app', () => {
  it('has every key in both languages, none of them empty, and each fills the same values', () => {
    const keys = Object.keys(MESSAGES.es) as MessageKey[];
    expect(Object.keys(MESSAGES.en).sort()).toEqual([...keys].sort());
    for (const key of keys) {
      expect(MESSAGES.es[key].trim(), `es ${key}`).not.toBe('');
      expect(MESSAGES.en[key].trim(), `en ${key}`).not.toBe('');
      expect(filled(MESSAGES.en[key]), key).toEqual(filled(MESSAGES.es[key]));
    }
  });

  it('are the only place with Spanish that a screen shows', () => {
    const found: string[] = [];
    for (const path of files(SOURCE)) {
      const name = relative(SOURCE, path);
      if (name in NOT_INTERFACE) continue;
      written(readFileSync(path, 'utf8')).forEach((line, index) => {
        if (/[áéíóúñÁÉÍÓÚÑ¿¡]/.test(line)) found.push(`${name}:${index + 1}: ${line.trim()}`);
      });
    }
    expect(found).toEqual([]);
  });
});

describe('the language of the app', () => {
  it('is Spanish when any language the device prefers is Spanish, and English otherwise', () => {
    expect(detectLanguage(['es-AR'])).toBe('es');
    expect(detectLanguage(['es'])).toBe('es');
    expect(detectLanguage(['es-419', 'en'])).toBe('es');
    expect(detectLanguage(['en-US', 'es'])).toBe('es');
    expect(detectLanguage(['en-US'])).toBe('en');
    expect(detectLanguage(['pt-BR', 'fr'])).toBe('en');
    expect(detectLanguage(['et'])).toBe('en');
    expect(detectLanguage([])).toBe('en');
  });
});
