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
  if (typeof theme.id !== 'string' || !/^[a-z0-9-]{1,40}$/.test(theme.id)) return ['id inválido'];
  if (typeof theme.nombre !== 'string' || !theme.nombre.trim() || theme.nombre.length > 40) return ['nombre inválido'];
  for (const part of ['claro', 'oscuro', 'fuentes', 'forma', 'recetas']) {
    if (!theme[part] || typeof theme[part] !== 'object') return [`falta ${part}`];
  }
  if (theme.logo !== undefined && (typeof theme.logo !== 'string' || !/^data:image\/(png|svg\+xml|webp);base64,[\w+/=]+$/.test(theme.logo))) return ['el logo tiene que ir como imagen incrustada'];
  const problems: string[] = [];
  for (const mode of ['claro', 'oscuro'] as const) {
    for (const key of COLOR_KEYS) {
      if (typeof theme[mode][key] !== 'string' || !COLOR.test(theme[mode][key])) problems.push(`${mode}: ${key} no es un color`);
    }
  }
  const { idea: _idea, nombre: _nombre, logo: _logo, ...styled } = theme;
  walk(styled, (text) => {
    if (!PLAIN_VALUE.test(text)) problems.push('tiene un valor que no se puede usar');
  });
  if (problems.length > 0) return [...new Set(problems)];
  for (const mode of ['claro', 'oscuro'] as const) {
    problems.push(...contrastReport(theme, mode).problems.map((problem) => `${mode}: ${problem}`));
  }
  return problems;
}
