import './temas.js';
import './aplicar-tema.js';

export type Mode = 'claro' | 'oscuro';

export interface Theme {
  id: string;
  nombre: string;
  logo?: string;
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
const DEFAULT_THEME = 'aula';

/** How the app looks on this device. Each person can change it, and the party only sets the starting point. */
class Ui {
  private extras = $state.raw<Theme[]>([]);
  private partyTheme = $state(DEFAULT_THEME);
  private chosenTheme = $state<string | null>(localStorage.getItem(THEME_KEY));
  private chosenMode = $state<Mode>(
    (localStorage.getItem(MODE_KEY) as Mode | null) ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'oscuro' : 'claro'),
  );
  /** While choosing, the whole screen shows the option being tried, and nothing is saved yet. */
  private trying = $state<{ theme: string; mode: Mode } | null>(null);

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
  }

  cancelTrying(): void {
    this.trying = null;
  }
}

export const ui = new Ui();
