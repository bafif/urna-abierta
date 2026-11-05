import { describe, expect, it } from 'vitest';
import { themeProblems } from '../src/theme-check.ts';

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
    expect(themeProblems(theme({ fuentes: { titulo: "'Mi Letra'" } }))).toEqual(['la letra Mi Letra no viene con la app ni adentro del archivo']);
  });

  it('takes a font that comes inside the file, even with the weight as a range', () => {
    expect(themeProblems(withMine([font('wOF2', { peso: '200 800', estilo: 'italic', ancho: '62% 125%' })]))).toEqual([]);
  });

  it('refuses a file that only says it is a font', () => {
    expect(themeProblems(withMine([font('<svg')]))).toEqual(['el archivo de la letra Mi Letra no es una letra']);
  });

  it('refuses a font that is not inside the file, and values that could reach a style', () => {
    expect(themeProblems(withMine([{ familia: 'Mi Letra', datos: 'https://otro.sitio/letra.woff2' }]))).toEqual(['la letra Mi Letra no viene adentro del archivo']);
    expect(themeProblems(withMine([font('wOF2', { familia: 'Mi Letra"; }' })]))).toEqual(['una letra tiene un nombre que no se puede usar']);
    expect(themeProblems(withMine([font('wOF2', { peso: 'bold;' })]))).toEqual(['la letra Mi Letra tiene un peso que no se puede usar']);
  });

  it('has a limit of size and of files', () => {
    expect(themeProblems(withMine(Array.from({ length: 25 }, () => font('wOF2'))))[0]).toMatch(/hasta 24/);
    const big = `data:font/woff2;base64,${btoa('wOF2xx')}${'A'.repeat(23 * 1024 * 1024)}`;
    expect(themeProblems(withMine([{ familia: 'Mi Letra', datos: big }]))[0]).toMatch(/pesan demasiado/);
  });
});
