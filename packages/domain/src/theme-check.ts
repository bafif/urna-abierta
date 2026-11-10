/** Whether a theme can be read. Used by the server for themes people add, and by the design tools. */
export type ThemeMode = 'claro' | 'oscuro';

/**
 * What is wrong with a theme: a code, and the part of the theme and the numbers it is about. The server sends it as it
 * is, and each screen says it in its own language with themeProblemText.
 */
export interface ThemeProblem {
  code: ThemeProblemCode;
  values?: Record<string, string | number>;
}

export interface ContrastReport {
  /** Each failing pair, as «texto on fondo gives 3.20:1 and needs 7:1». */
  problems: ThemeProblem[];
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
  // Each pair says what it is in the theme's own names: two colors, or a band.
  const pairs: [{ front?: string; back?: string; band?: string }, string, string, number][] = RULES
    // A primary button may sit on its own footer band instead of the page background.
    .filter((rule) => !(rule[0] === 'primario' && colors.fondoPie))
    .map(([a, b, need]) => [{ front: a, back: b }, colors[a], colors[b], need]);
  if (colors.fondoPie) pairs.push([{ front: 'primario', back: 'fondoPie' }, colors.primario, colors.fondoPie, 3]);
  if (theme.recetas.cabecera === 'banda') {
    for (const [name, band] of Object.entries<[string, string]>(colors.bandas ?? {})) pairs.push([{ band: name }, band[0], band[1], 4.5]);
  }
  const report: ContrastReport = { problems: [], main: contrastRatio(colors.texto, colors.fondo), lowest: Infinity };
  for (const [pair, a, b, need] of pairs) {
    const value = contrastRatio(a, b);
    report.lowest = Math.min(report.lowest, value / need);
    if (value < need) report.problems.push({ code: pair.band ? 'band_contrast' : 'contrast', values: { mode, ...pair, ratio: value.toFixed(2), needs: need } });
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

function fontProblems(fonts: unknown): ThemeProblem[] {
  if (fonts === undefined) return [];
  if (!Array.isArray(fonts) || fonts.length > MAX_THEME_FONTS) return [{ code: 'too_many_fonts', values: { max: MAX_THEME_FONTS } }];
  let bytes = 0;
  for (const font of fonts) {
    if (!font || typeof font.familia !== 'string' || !FONT_NAME.test(font.familia)) return [{ code: 'bad_font_name' }];
    const name = font.familia;
    if (font.peso !== undefined && !FONT_WEIGHT.test(String(font.peso))) return [{ code: 'bad_font_weight', values: { font: name } }];
    if (font.estilo !== undefined && !['normal', 'italic'].includes(font.estilo)) return [{ code: 'bad_font_style', values: { font: name } }];
    if (font.ancho !== undefined && !FONT_STRETCH.test(String(font.ancho))) return [{ code: 'bad_font_stretch', values: { font: name } }];
    const data = typeof font.datos === 'string' ? FONT_DATA.exec(font.datos) : null;
    if (!data) return [{ code: 'font_not_inside', values: { font: name } }];
    if (!FONT_SIGNATURES.includes(atob(data[2]!.slice(0, 8)).slice(0, 4))) return [{ code: 'not_a_font', values: { font: name } }];
    bytes += (data[2]!.length * 3) / 4;
  }
  return bytes > MAX_THEME_FONT_BYTES ? [{ code: 'fonts_too_heavy', values: { max: MAX_THEME_FONT_BYTES / 1024 / 1024 } }] : [];
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
export function themeProblems(theme: any): ThemeProblem[] {
  if (!theme || typeof theme !== 'object') return [{ code: 'not_theme' }];
  if (typeof theme.id !== 'string' || !THEME_ID.test(theme.id)) return [{ code: 'bad_id' }];
  if (typeof theme.nombre !== 'string' || !theme.nombre.trim() || theme.nombre.length > 40) return [{ code: 'bad_name' }];
  for (const part of ['claro', 'oscuro', 'fuentes', 'forma', 'recetas']) {
    if (!theme[part] || typeof theme[part] !== 'object') return [{ code: 'missing_part', values: { part } }];
  }
  if (theme.logo !== undefined && (typeof theme.logo !== 'string' || !/^data:image\/(png|svg\+xml|webp);base64,[\w+/=]+$/.test(theme.logo))) return [{ code: 'bad_logo' }];
  if (theme.idea !== undefined && (typeof theme.idea !== 'string' || theme.idea.length > MAX_IDEA || /[\u0000-\u0008\u000b-\u001f\u007f]/.test(theme.idea))) return [{ code: 'bad_idea', values: { max: MAX_IDEA } }];
  const { archivosFuentes: _withFonts, ...withoutFonts } = theme;
  if (new TextEncoder().encode(JSON.stringify(withoutFonts)).length > MAX_THEME_BYTES_WITHOUT_FONTS) return [{ code: 'too_heavy', values: { max: MAX_THEME_BYTES_WITHOUT_FONTS / 1024 } }];
  const problems: ThemeProblem[] = [];
  for (const mode of ['claro', 'oscuro'] as const) {
    for (const key of COLOR_KEYS) {
      if (typeof theme[mode][key] !== 'string' || !COLOR.test(theme[mode][key])) problems.push({ code: 'not_color', values: { mode, key } });
    }
  }
  const { idea: _idea, nombre: _nombre, logo: _logo, archivosFuentes: _fonts, ...styled } = theme;
  walk(styled, (text) => {
    if (!PLAIN_VALUE.test(text)) problems.push({ code: 'bad_value' });
  });
  problems.push(...fontProblems(theme.archivosFuentes));
  if (problems.length > 0) return distinct(problems);
  const included = (theme.archivosFuentes ?? []).map((font: { familia: string }) => font.familia);
  for (const value of Object.values(theme.fuentes)) {
    const family = firstFamily(value);
    if (family && !BUILT_IN_FONTS.includes(family) && !SYSTEM_FONTS.includes(family) && !included.includes(family)) problems.push({ code: 'missing_font', values: { font: family } });
  }
  if (problems.length > 0) return distinct(problems);
  for (const mode of ['claro', 'oscuro'] as const) {
    problems.push(...contrastReport(theme, mode).problems);
  }
  return problems;
}

/** The same problem once, however many values of the theme have it. */
const distinct = (problems: ThemeProblem[]): ThemeProblem[] => [...new Map(problems.map((problem) => [JSON.stringify(problem), problem])).values()];

/** What each problem says. The names of the parts of a theme (claro, texto, fondo…) are those of its file, in both. */
export const THEME_PROBLEM_TEXT = {
  es: {
    not_theme: 'no es un tema',
    bad_id: 'id inválido',
    bad_name: 'nombre inválido',
    missing_part: 'falta {part}',
    bad_logo: 'el logo tiene que ir como imagen incrustada',
    bad_idea: 'la idea tiene que ser un texto de hasta {max} letras',
    too_heavy: 'el tema pesa demasiado sin las letras: el máximo es {max} KB, logo incluido',
    not_color: '{mode}: {key} no es un color',
    bad_value: 'tiene un valor que no se puede usar',
    too_many_fonts: 'se pueden incluir hasta {max} archivos de letras',
    bad_font_name: 'una letra tiene un nombre que no se puede usar',
    bad_font_weight: 'la letra {font} tiene un peso que no se puede usar',
    bad_font_style: 'la letra {font} tiene un estilo que no se puede usar',
    bad_font_stretch: 'la letra {font} tiene un ancho que no se puede usar',
    font_not_inside: 'la letra {font} no viene adentro del archivo',
    not_a_font: 'el archivo de la letra {font} no es una letra',
    fonts_too_heavy: 'las letras pesan demasiado: el máximo es {max} MB',
    missing_font: 'la letra {font} no viene con la app ni adentro del archivo',
    contrast: '{mode}: {front} sobre {back} da {ratio}:1 y necesita {needs}:1',
    band_contrast: '{mode}: la banda {band} da {ratio}:1 y necesita {needs}:1',
  },
  en: {
    not_theme: 'this is not a theme',
    bad_id: 'invalid id',
    bad_name: 'invalid name',
    missing_part: '{part} is missing',
    bad_logo: 'the logo has to be an embedded image',
    bad_idea: 'the idea has to be a text of up to {max} characters',
    too_heavy: 'the theme is too heavy without its fonts: the limit is {max} KB, logo included',
    not_color: '{mode}: {key} is not a color',
    bad_value: 'it has a value that cannot be used',
    too_many_fonts: 'it can include up to {max} font files',
    bad_font_name: 'a font has a name that cannot be used',
    bad_font_weight: 'the font {font} has a weight that cannot be used',
    bad_font_style: 'the font {font} has a style that cannot be used',
    bad_font_stretch: 'the font {font} has a width that cannot be used',
    font_not_inside: 'the font {font} is not inside the file',
    not_a_font: 'the file of the font {font} is not a font',
    fonts_too_heavy: 'the fonts are too heavy: the limit is {max} MB',
    missing_font: 'the font {font} neither comes with the app nor is inside the file',
    contrast: '{mode}: {front} on {back} gives {ratio}:1 and needs {needs}:1',
    band_contrast: '{mode}: the band {band} gives {ratio}:1 and needs {needs}:1',
  },
} as const satisfies Record<'es' | 'en', Record<string, string>>;

export type ThemeProblemCode = keyof (typeof THEME_PROBLEM_TEXT)['es'];

/** A problem in words. Anything else, like a problem from an older server, shows as it came, or not at all. */
export function themeProblemText(problem: unknown, language: 'es' | 'en'): string {
  if (typeof problem === 'string') return problem;
  const { code, values = {} } = (problem ?? {}) as Partial<ThemeProblem>;
  const texts: Record<string, string> = THEME_PROBLEM_TEXT[language];
  if (typeof code !== 'string' || !(code in texts)) return '';
  return texts[code]!.replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? ''));
}
