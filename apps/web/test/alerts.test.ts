import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALERT_POLL_MS, AlertWatch, pollAlerts } from '../src/lib/alerts.ts';

describe('what tells the chief about an alert', () => {
  let badge: number;
  let rung: number;

  beforeEach(() => {
    badge = 0;
    rung = 0;
    vi.stubGlobal('document', { title: 'Urna Abierta', visibilityState: 'visible', addEventListener: () => undefined, removeEventListener: () => undefined });
    vi.stubGlobal('navigator', {
      setAppBadge: async (count: number) => {
        badge = count;
      },
      clearAppBadge: async () => {
        badge = 0;
      },
      vibrate: () => {
        rung += 1;
        return true;
      },
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('what was open the first time makes no noise; a new one rings, once, wherever it is read', async () => {
    const watch = new AlertWatch();
    watch.update('e-1', ['a-1']);
    expect(rung).toBe(0);
    expect(document.title).toBe('(1) Urna Abierta');
    watch.update('e-1', ['a-1', 'a-2']);
    expect(rung).toBe(1);
    // The panel reads the same alert after the poll did: it does not ring again.
    watch.update('e-1', ['a-1', 'a-2']);
    expect(rung).toBe(1);
  });

  it('the count adds up every election, and stopping takes it off the icon too', async () => {
    const watch = new AlertWatch();
    watch.update('e-1', ['a-1']);
    watch.update('e-2', ['b-1', 'b-2']);
    await Promise.resolve();
    expect(document.title).toBe('(3) Urna Abierta');
    expect(badge).toBe(3);
    watch.update('e-2', []);
    expect(document.title).toBe('(1) Urna Abierta');
    watch.stop();
    await Promise.resolve();
    expect(document.title).toBe('Urna Abierta');
    expect(badge).toBe(0);
  });

  it('the poll rings on any screen when an alert arrives, keeps asking without signal, and stops', async () => {
    vi.useFakeTimers();
    const answers: ({ id: string; open: string[] }[] | Error)[] = [[{ id: 'e-1', open: [] }], new Error('sin señal'), [{ id: 'e-1', open: ['a-1'] }]];
    let asked = 0;
    const watch = new AlertWatch();
    const stop = pollAlerts(async () => {
      const answer = answers[Math.min(asked++, answers.length - 1)]!;
      if (answer instanceof Error) throw answer;
      return answer;
    }, watch);
    await vi.advanceTimersByTimeAsync(0);
    expect(rung).toBe(0);
    await vi.advanceTimersByTimeAsync(ALERT_POLL_MS);
    expect(rung).toBe(0);
    await vi.advanceTimersByTimeAsync(ALERT_POLL_MS);
    expect(rung).toBe(1);
    expect(document.title).toBe('(1) Urna Abierta');
    stop();
    const before = asked;
    await vi.advanceTimersByTimeAsync(ALERT_POLL_MS * 3);
    expect(asked).toBe(before);
    expect(document.title).toBe('Urna Abierta');
  });
});
