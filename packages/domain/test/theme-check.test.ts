import { describe, expect, it } from 'vitest';
import { THEME_PROBLEM_TEXT, themeProblemText, themeProblems, type ThemeProblem } from '../src/theme-check.ts';

/** The problems as the Spanish screens say them. */
const said = (problems: ThemeProblem[]) => problems.map((problem) => themeProblemText(problem, 'es'));

const colors = Object.fromEntries(
  (['superficie', 'superficie2', 'linea', 'margen', 'sobrePrimario', 'sobrePeligro', 'bienFondo', 'fondo', 'peligroFondo'] as string[])
    .map((key) => [key, '#ffffff'])
    .concat([['texto', '#101010'], ['suave', '#555555'], ['primario', '#101010'], ['acento', '#101010'], ['marca', '#101010'], ['peligro', '#a00000'], ['peligroTexto', '#a00000'], ['bien', '#0a5a2a']]),
);
const theme = (extra: object = {}) => ({ id: 'propio', nombre: 'Propio', fuentes: { titulo: "'Poppins', sans-serif" }, forma: { radio: '8px' }, recetas: { tachado: 'linea', cabecera: 'simple' }, claro: colors, oscuro: colors, ...extra });
const font = (start: string, extra: object = {}) => ({ familia: 'Mi Letra', peso: '400', datos: `data:font/woff2;base64,${btoa(`${start}resto del archivo`)}`, ...extra });
const withMine = (fonts: unknown) => theme({ fuentes: { titulo: "'Mi Letra'" }, archivosFuentes: fonts });

describe('the fonts of a theme', () => {
  it('can use the fonts of the app without bringing anything', () => {
    expect(themeProblems(theme())).toEqual([]);
  });

  it('asks for a font that neither the app nor the file has', () => {
    expect(said(themeProblems(theme({ fuentes: { titulo: "'Mi Letra'" } })))).toEqual(['la letra Mi Letra no viene con la app ni adentro del archivo']);
  });

  it('takes a font that comes inside the file, even with the weight as a range', () => {
    expect(themeProblems(withMine([font('wOF2', { peso: '200 800', estilo: 'italic', ancho: '62% 125%' })]))).toEqual([]);
  });

  it('refuses a file that only says it is a font', () => {
    expect(said(themeProblems(withMine([font('<svg')])))).toEqual(['el archivo de la letra Mi Letra no es una letra']);
  });

  it('refuses a font that is not inside the file, and values that could reach a style', () => {
    expect(said(themeProblems(withMine([{ familia: 'Mi Letra', datos: 'https://otro.sitio/letra.woff2' }])))).toEqual(['la letra Mi Letra no viene adentro del archivo']);
    expect(said(themeProblems(withMine([font('wOF2', { familia: 'Mi Letra"; }' })])))).toEqual(['una letra tiene un nombre que no se puede usar']);
    expect(said(themeProblems(withMine([font('wOF2', { peso: 'bold;' })])))).toEqual(['la letra Mi Letra tiene un peso que no se puede usar']);
  });

  it('has a limit of size and of files', () => {
    expect(said(themeProblems(withMine(Array.from({ length: 25 }, () => font('wOF2')))))[0]).toMatch(/hasta 24/);
    const big = `data:font/woff2;base64,${btoa('wOF2xx')}${'A'.repeat(23 * 1024 * 1024)}`;
    expect(said(themeProblems(withMine([{ familia: 'Mi Letra', datos: big }])))[0]).toMatch(/pesan demasiado/);
  });
});

describe('what a theme carries besides its fonts', () => {
  it('has an idea that is a short text, and a weight that every phone can take each time it opens', () => {
    expect(themeProblems(theme({ idea: 'Azul y dorado, con letra grande.' }))).toEqual([]);
    expect(said(themeProblems(theme({ idea: 'x'.repeat(601) })))[0]).toMatch(/idea/);
    expect(said(themeProblems(theme({ idea: { html: '<b>' } })))[0]).toMatch(/idea/);
    expect(said(themeProblems(theme({ logo: `data:image/png;base64,${'A'.repeat(300_000)}` })))[0]).toMatch(/pesa demasiado/);
  });
});

describe('what a problem of a theme says', () => {
  it('is a code that each screen says in its language', () => {
    const [problem] = themeProblems(withMine([font('<svg')]));
    expect(problem).toEqual({ code: 'not_a_font', values: { font: 'Mi Letra' } });
    expect(themeProblemText(problem, 'en')).toBe('the file of the font Mi Letra is not a font');
  });

  it('says a pair that does not reach its contrast with the names of the file and both numbers', () => {
    const dim = { ...colors, texto: '#999999' };
    const problems = themeProblems(theme({ claro: dim }));
    expect(said(problems)).toContain('claro: texto sobre fondo da 2.85:1 y necesita 7:1');
    expect(problems.map((problem) => themeProblemText(problem, 'en'))).toContain('claro: texto on fondo gives 2.85:1 and needs 7:1');
  });

  it('has every text in both languages, with the same values', () => {
    const names = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
    expect(Object.keys(THEME_PROBLEM_TEXT.en).sort()).toEqual(Object.keys(THEME_PROBLEM_TEXT.es).sort());
    for (const [code, text] of Object.entries(THEME_PROBLEM_TEXT.es)) {
      expect(names(THEME_PROBLEM_TEXT.en[code as keyof typeof THEME_PROBLEM_TEXT.en]), code).toEqual(names(text));
    }
  });

  it('shows a text from an older server as it came, and nothing for a code it does not know', () => {
    expect(themeProblemText('id inválido', 'en')).toBe('id inválido');
    expect(themeProblemText({ code: 'nuevo' }, 'en')).toBe('');
    expect(themeProblemText(null, 'es')).toBe('');
  });
});
