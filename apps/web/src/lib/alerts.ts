/**
 * Lets the chief know a new alert came in while the app is open: the phone vibrates and beeps, and the count goes
 * on the app's icon and in the tab's title. Alerts already there when the panel opened make no noise: they are on
 * screen. With the app closed none of this can happen.
 */
const TITLE = 'Urna Abierta';

class AlertWatch {
  /** The alerts seen so far in each election. */
  private readonly seen = new Map<string, Set<string>>();

  /** The alerts open now in an election. */
  update(election: string, open: string[]): void {
    const known = this.seen.get(election);
    const fresh = known ? open.filter((id) => !known.has(id)) : [];
    this.seen.set(election, new Set([...(known ?? []), ...open]));
    document.title = open.length > 0 ? `(${open.length}) ${TITLE}` : TITLE;
    if ('setAppBadge' in navigator) void (open.length > 0 ? navigator.setAppBadge(open.length) : navigator.clearAppBadge()).catch(() => undefined);
    if (fresh.length > 0) ring();
  }

  /** When the panel is not on screen, its title does not stay behind. */
  leave(): void {
    document.title = TITLE;
  }
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
