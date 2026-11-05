import { resolve } from '$app/paths';
import './temas.js';
import './aplicar-tema.js';

export type Mode = 'claro' | 'oscuro';

export interface ThemeFont {
  familia: string;
  peso?: string;
  estilo?: string;
  ancho?: string;
  sha256: string;
}

export interface Theme {
  id: string;
  nombre: string;
  logo?: string;
  archivosFuentes?: ThemeFont[];
  claro: Record<string, string>;
  oscuro: Record<string, string>;
  fuentes: Record<string, string>;
  forma: Record<string, string>;
  recetas: Record<string, unknown>;
}

declare global {
  interface Window {
    TEMAS: Theme[];
    URNA_TEMA: {
      variables(theme: Theme, mode: Mode, action: string): string;
      recetas(theme: Theme): Record<string, string>;
    };
  }
  interface Navigator {
    standalone?: boolean;
  }
}

const THEME_KEY = 'urna-abierta-tema';
const MODE_KEY = 'urna-abierta-modo';
const PARTY_KEY = 'urna-abierta-tema-partido';
const OWN_THEMES_KEY = 'urna-abierta-temas-propios';
/** Outside the prefix of the app files, so that an update does not throw them away. */
const FONTS_CACHE = 'temas-propios';
const DEFAULT_THEME = 'aula';

const fontUrl = (sha256: string) => `${resolve('/')}api/theme-fonts/${sha256}`;

function savedThemes(): Theme[] {
  try {
    return JSON.parse(localStorage.getItem(OWN_THEMES_KEY) ?? '[]');
  } catch {
    return [];
  }
}

/** How the app looks on this device. Each person can change it, and the party only sets the starting point. */
class Ui {
  /** Saved on the phone: with no signal, a party's theme has to stay the same. */
  private extras = $state.raw<Theme[]>(savedThemes());
  private partyTheme = $state(localStorage.getItem(PARTY_KEY) ?? DEFAULT_THEME);
  private fontsKnown = new Set<string>();
  private chosenTheme = $state<string | null>(localStorage.getItem(THEME_KEY));
  private chosenMode = $state<Mode>(
    (localStorage.getItem(MODE_KEY) as Mode | null) ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'oscuro' : 'claro'),
  );
  /** While choosing, the whole screen shows the option being tried, and nothing is saved yet. */
  private trying = $state<{ theme: string; mode: Mode } | null>(null);

  constructor() {
    this.addFonts();
  }

  /** The browser only downloads a font when something uses it. */
  private addFonts(): void {
    for (const font of this.extras.flatMap((theme) => theme.archivosFuentes ?? [])) {
      if (this.fontsKnown.has(font.sha256)) continue;
      this.fontsKnown.add(font.sha256);
      document.fonts.add(new FontFace(font.familia, `url("${fontUrl(font.sha256)}")`, { weight: font.peso ?? 'normal', style: font.estilo ?? 'normal', stretch: font.ancho ?? 'normal', display: 'swap' }));
    }
  }

  /** The fonts of the theme in use stay on the phone, for when there is no signal. If there is no room, it goes on without them. */
  private keepFontsOffline(): void {
    const urls = (this.theme.archivosFuentes ?? []).map((font) => fontUrl(font.sha256));
    if (urls.length === 0 || typeof caches === 'undefined') return;
    void caches
      .open(FONTS_CACHE)
      .then(async (cache) => {
        for (const url of urls) if (!(await cache.match(url))) await cache.add(url);
      })
      .catch(() => undefined);
  }

  get all(): Theme[] {
    return [...window.TEMAS, ...this.extras];
  }

  get theme(): Theme {
    const id = this.trying?.theme ?? this.chosenTheme ?? this.partyTheme;
    return this.all.find((theme) => theme.id === id) ?? this.all.find((theme) => theme.id === DEFAULT_THEME) ?? this.all[0]!;
  }

  get mode(): Mode {
    return this.trying?.mode ?? this.chosenMode;
  }

  get hasChosen(): boolean {
    return this.chosenTheme !== null;
  }

  usePartySettings(party: { theme?: string }, themes: Theme[]): void {
    this.extras = themes;
    if (party.theme) this.partyTheme = party.theme;
    try {
      localStorage.setItem(OWN_THEMES_KEY, JSON.stringify(themes));
      localStorage.setItem(PARTY_KEY, this.partyTheme);
    } catch {
      // A phone with no room: it stays as it was.
    }
    this.addFonts();
    this.keepFontsOffline();
  }

  startTrying(): void {
    this.trying = { theme: this.theme.id, mode: this.mode };
  }

  tryTheme(theme: string): void {
    this.trying = { theme, mode: this.mode };
  }

  tryMode(mode: Mode): void {
    this.trying = { theme: this.theme.id, mode };
  }

  /** Keeps what is on screen. */
  keep(): void {
    this.chosenTheme = this.theme.id;
    this.chosenMode = this.mode;
    this.trying = null;
    localStorage.setItem(THEME_KEY, this.chosenTheme);
    localStorage.setItem(MODE_KEY, this.chosenMode);
    this.keepFontsOffline();
  }

  cancelTrying(): void {
    this.trying = null;
  }
}

export const ui = new Ui();
