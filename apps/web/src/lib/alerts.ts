/**
 * Lets the chief know a new alert came in while the app is open: the phone vibrates and beeps, and the count goes
 * on the app's icon and in the tab's title. Alerts already there when the panel opened make no noise: they are on
 * screen. With the app closed none of this can happen.
 */
const TITLE = 'Urna Abierta';

export class AlertWatch {
  /** The alerts seen so far in each election. */
  private readonly seen = new Map<string, Set<string>>();
  /** Each time the panel comes on screen it takes a new turn: what an earlier one reads after it left does not count. */
  private turn = 0;

  /** The panel is on screen: what it reads with this turn shows on the icon and the title. */
  watch(): number {
    this.turn += 1;
    return this.turn;
  }

  /** The alerts open now in an election. */
  update(turn: number, election: string, open: string[]): void {
    if (turn !== this.turn) return;
    const known = this.seen.get(election);
    const fresh = known ? open.filter((id) => !known.has(id)) : [];
    this.seen.set(election, new Set([...(known ?? []), ...open]));
    document.title = open.length > 0 ? `(${open.length}) ${TITLE}` : TITLE;
    badge(open.length);
    if (fresh.length > 0) ring();
  }

  /** When the panel is not on screen, nothing keeps the count up to date: neither the title nor the icon keep it. */
  leave(turn: number): void {
    if (turn !== this.turn) return;
    this.turn += 1;
    document.title = TITLE;
    badge(0);
  }
}

function badge(count: number): void {
  if ('setAppBadge' in navigator) void (count > 0 ? navigator.setAppBadge(count) : navigator.clearAppBadge()).catch(() => undefined);
}

function ring(): void {
  navigator.vibrate?.([300, 120, 300]);
  try {
    const audio = new AudioContext();
    const tone = audio.createOscillator();
    const volume = audio.createGain();
    tone.frequency.value = 880;
    volume.gain.setValueAtTime(0.25, audio.currentTime);
    volume.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.5);
    tone.connect(volume).connect(audio.destination);
    tone.onended = () => void audio.close();
    tone.start();
    tone.stop(audio.currentTime + 0.5);
  } catch {
    // Without sound, the vibration, the icon and the title still say it.
  }
}

export const alertWatch = new AlertWatch();
