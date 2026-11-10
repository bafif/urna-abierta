/** Whether a theme can be read. Used by the server for themes people add, and by the design tools. */
export type ThemeMode = 'claro' | 'oscuro';

export interface ContrastReport {
  /** Each failing pair, as «text on background gives 3.2:1 and needs 7:1». */
  problems: string[];
  /** Text on background, for showing. */
  main: number;
  /** The tightest pair, as a share of what it needs. Under 1 is a failure. */
  lowest: number;
}

const luminance = (hex: string): number => {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

// What is read for a long time must reach 7:1, thinking of older eyes. Marks and lines only need 3:1.
const RULES: [string, string, number][] = [
  ['texto', 'fondo', 7], ['texto', 'superficie', 7], ['texto', 'superficie2', 7],
  ['suave', 'fondo', 4.5], ['suave', 'superficie', 4.5],
  ['sobrePrimario', 'primario', 4.5], ['sobrePeligro', 'peligro', 4.5], ['peligroTexto', 'peligroFondo', 4.5],
  ['bien', 'bienFondo', 4.5], ['marca', 'fondo', 3], ['primario', 'fondo', 3], ['acento', 'fondo', 3],
];

export function contrastReport(theme: any, mode: ThemeMode): ContrastReport {
  const colors = theme[mode];
  const pairs: [string, string, string, number][] = RULES
    // A primary button may sit on its own footer band instead of the page background.
    .filter((rule) => !(rule[0] === 'primario' && colors.fondoPie))
    .map(([a, b, need]) => [`${a} sobre ${b}`, colors[a], colors[b], need]);
  if (colors.fondoPie) pairs.push(['primario sobre su pie', colors.primario, colors.fondoPie, 3]);
  if (theme.recetas.cabecera === 'banda') {
    for (const [name, band] of Object.entries<[string, string]>(colors.bandas ?? {})) pairs.push([`banda ${name}`, band[0], band[1], 4.5]);
  }
  const report: ContrastReport = { problems: [], main: contrastRatio(colors.texto, colors.fondo), lowest: Infinity };
  for (const [name, a, b, need] of pairs) {
    const value = contrastRatio(a, b);
    report.lowest = Math.min(report.lowest, value / need);
    if (value < need) report.problems.push(`${name} da ${value.toFixed(2)}:1 y necesita ${need}:1`);
  }
  return report;
}

/** The fonts that come with the app. Any other has to come inside the theme. */
export const BUILT_IN_FONTS = ['Atkinson Hyperlegible Next', 'Anton', 'Barlow Condensed', 'Poppins', 'Onest Variable', 'Gabarito Variable', 'Archivo Variable', 'Nunito Variable'];
const SYSTEM_FONTS = ['system-ui', 'sans-serif', 'serif', 'monospace', 'ui-monospace', 'ui-sans-serif', 'ui-serif', 'cursive'];
export const MAX_THEME_FONTS = 24;
export const MAX_THEME_FONT_BYTES = 16 * 1024 * 1024;
/** Everything but the fonts goes to every phone each time it opens, logo included: a real one is about 17 KB. */
export const MAX_THEME_BYTES_WITHOUT_FONTS = 256 * 1024;
/** How many themes a party can add. One with the same id replaces the other, and does not count again. */
export const MAX_PARTY_THEMES = 12;
/** The themes that come with the app, in apps/web/src/lib/temas.js: a party can choose these without adding them. */
export const BUILT_IN_THEMES = ['aula', 'vidrio', 'feria', 'tablero', 'mate'];
export const THEME_ID = /^[a-z0-9-]{1,40}$/;
const MAX_IDEA = 600;

const FONT_NAME = /^[\p{L}\p{N} _-]{1,60}$/u;
const FONT_WEIGHT = /^\d{1,4}( \d{1,4})?$/;
const FONT_STRETCH = /^\d{1,3}%( \d{1,3}%)?$/;
const FONT_DATA = /^data:font\/(woff2|woff|ttf|otf);base64,([A-Za-z0-9+/]+={0,2})$/;
/** The first bytes of each format: a file renamed as a font does not get in. */
const FONT_SIGNATURES = ['wOF2', 'wOFF', '\u0000\u0001\u0000\u0000', 'OTTO', 'true'];

function fontProblems(fonts: unknown): string[] {
  if (fonts === undefined) return [];
  if (!Array.isArray(fonts) || fonts.length > MAX_THEME_FONTS) return [`se pueden incluir hasta ${MAX_THEME_FONTS} archivos de letras`];
  let bytes = 0;
  for (const font of fonts) {
    if (!font || typeof font.familia !== 'string' || !FONT_NAME.test(font.familia)) return ['una letra tiene un nombre que no se puede usar'];
    const name = font.familia;
    if (font.peso !== undefined && !FONT_WEIGHT.test(String(font.peso))) return [`la letra ${name} tiene un peso que no se puede usar`];
    if (font.estilo !== undefined && !['normal', 'italic'].includes(font.estilo)) return [`la letra ${name} tiene un estilo que no se puede usar`];
    if (font.ancho !== undefined && !FONT_STRETCH.test(String(font.ancho))) return [`la letra ${name} tiene un ancho que no se puede usar`];
    const data = typeof font.datos === 'string' ? FONT_DATA.exec(font.datos) : null;
    if (!data) return [`la letra ${name} no viene adentro del archivo`];
    if (!FONT_SIGNATURES.includes(atob(data[2]!.slice(0, 8)).slice(0, 4))) return [`el archivo de la letra ${name} no es una letra`];
    bytes += (data[2]!.length * 3) / 4;
  }
  return bytes > MAX_THEME_FONT_BYTES ? [`las letras pesan demasiado: el máximo es ${MAX_THEME_FONT_BYTES / 1024 / 1024} MB`] : [];
}

/** The first font of what a theme asks for: if that one is missing, the theme does not look like itself. */
const firstFamily = (value: unknown) => (typeof value === 'string' ? (value.split(',')[0] ?? '').trim().replace(/^["']|["']$/g, '') : '');

const COLOR = /^#[0-9a-fA-F]{6}$/;
const COLOR_KEYS = ['fondo', 'superficie', 'superficie2', 'texto', 'suave', 'linea', 'margen', 'primario', 'sobrePrimario', 'acento', 'marca', 'peligro', 'sobrePeligro', 'peligroFondo', 'peligroTexto', 'bien', 'bienFondo'];
/** What a theme writes ends up in a style attribute, so it can only be plain values. */
const PLAIN_VALUE = /^[\w\s"',.#%()-]{0,120}$/;

const walk = (value: unknown, visit: (text: string) => void): void => {
  if (typeof value === 'string') visit(value);
  else if (value && typeof value === 'object') for (const item of Object.values(value)) walk(item, visit);
};

/** Everything wrong with a theme someone adds. An empty list means it can be used. */
export function themeProblems(theme: any): string[] {
  if (!theme || typeof theme !== 'object') return ['no es un tema'];
  if (typeof theme.id !== 'string' || !THEME_ID.test(theme.id)) return ['id inválido'];
  if (typeof theme.nombre !== 'string' || !theme.nombre.trim() || theme.nombre.length > 40) return ['nombre inválido'];
  for (const part of ['claro', 'oscuro', 'fuentes', 'forma', 'recetas']) {
    if (!theme[part] || typeof theme[part] !== 'object') return [`falta ${part}`];
  }
  if (theme.logo !== undefined && (typeof theme.logo !== 'string' || !/^data:image\/(png|svg\+xml|webp);base64,[\w+/=]+$/.test(theme.logo))) return ['el logo tiene que ir como imagen incrustada'];
  if (theme.idea !== undefined && (typeof theme.idea !== 'string' || theme.idea.length > MAX_IDEA || /[\u0000-\u0008\u000b-\u001f\u007f]/.test(theme.idea))) return [`la idea tiene que ser un texto de hasta ${MAX_IDEA} letras`];
  const { archivosFuentes: _withFonts, ...withoutFonts } = theme;
  if (new TextEncoder().encode(JSON.stringify(withoutFonts)).length > MAX_THEME_BYTES_WITHOUT_FONTS) return [`el tema pesa demasiado sin las letras: el máximo es ${MAX_THEME_BYTES_WITHOUT_FONTS / 1024} KB, logo incluido`];
  const problems: string[] = [];
  for (const mode of ['claro', 'oscuro'] as const) {
    for (const key of COLOR_KEYS) {
      if (typeof theme[mode][key] !== 'string' || !COLOR.test(theme[mode][key])) problems.push(`${mode}: ${key} no es un color`);
    }
  }
  const { idea: _idea, nombre: _nombre, logo: _logo, archivosFuentes: _fonts, ...styled } = theme;
  walk(styled, (text) => {
    if (!PLAIN_VALUE.test(text)) problems.push('tiene un valor que no se puede usar');
  });
  problems.push(...fontProblems(theme.archivosFuentes));
  if (problems.length > 0) return [...new Set(problems)];
  const included = (theme.archivosFuentes ?? []).map((font: { familia: string }) => font.familia);
  for (const value of Object.values(theme.fuentes)) {
    const family = firstFamily(value);
    if (family && !BUILT_IN_FONTS.includes(family) && !SYSTEM_FONTS.includes(family) && !included.includes(family)) problems.push(`la letra ${family} no viene con la app ni adentro del archivo`);
  }
  if (problems.length > 0) return [...new Set(problems)];
  for (const mode of ['claro', 'oscuro'] as const) {
    problems.push(...contrastReport(theme, mode).problems.map((problem) => `${mode}: ${problem}`));
  }
  return problems;
}
