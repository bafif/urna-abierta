/**
 * Lets whoever looks after tables know a new alert came in while the app is open, on any screen: the phone vibrates
 * and beeps, and the count goes on the app's icon and in the tab's title. Alerts already there the first time an
 * election is read make no noise: the count says them. With the app closed none of this can happen.
 */
const TITLE = 'Urna Abierta';
/** How often the app asks, on any screen. The district panel asks for itself more often while an alert is open. */
export const ALERT_POLL_MS = 15_000;

export class AlertWatch {
  /** The alerts seen so far in each election. */
  private readonly seen = new Map<string, Set<string>>();
  /** How many are open now in each election. */
  private readonly open = new Map<string, number>();

  /** The alerts open now in an election, from the panel or from the poll. */
  update(election: string, open: string[]): void {
    const known = this.seen.get(election);
    const fresh = known ? open.filter((id) => !known.has(id)) : [];
    this.seen.set(election, new Set([...(known ?? []), ...open]));
    this.open.set(election, open.length);
    this.show();
    if (fresh.length > 0) ring();
  }

  /** Whoever was looking left (the session ended, or it no longer watches tables): nothing stays on the icon. */
  stop(): void {
    this.seen.clear();
    this.open.clear();
    this.show();
  }

  private show(): void {
    const count = [...this.open.values()].reduce((sum, value) => sum + value, 0);
    document.title = count > 0 ? `(${count}) ${TITLE}` : TITLE;
    badge(count);
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

/**
 * Asks for the open alerts every so often, also with the app in the background, so that the icon and the title keep
 * up. Without signal it waits for the next turn. Returns what stops it.
 */
export function pollAlerts(read: () => Promise<{ id: string; open: string[] }[]>, watch: AlertWatch = alertWatch): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let asking = false;
  const tick = async () => {
    if (asking) return;
    asking = true;
    clearTimeout(timer);
    try {
      const elections = await read();
      if (!stopped) for (const election of elections) watch.update(election.id, election.open);
    } catch {
      // No signal, or the server is busy: the next turn asks again.
    }
    asking = false;
    if (!stopped) timer = setTimeout(tick, ALERT_POLL_MS);
  };
  const back = () => {
    if (document.visibilityState === 'visible') void tick();
  };
  void tick();
  document.addEventListener('visibilitychange', back);
  return () => {
    stopped = true;
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', back);
    watch.stop();
  };
}
