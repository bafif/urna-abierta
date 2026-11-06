import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AlertWatch } from '../src/lib/alerts.ts';

describe('what tells the chief about an alert', () => {
  let badge: number;
  let rung: number;

  beforeEach(() => {
    badge = 0;
    rung = 0;
    vi.stubGlobal('document', { title: 'Urna Abierta' });
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
  afterEach(() => vi.unstubAllGlobals());

  it('leaving the panel takes the count off the icon too, not only off the title', async () => {
    const watch = new AlertWatch();
    const turn = watch.watch();
    watch.update(turn, 'e-1', ['a-1']);
    await Promise.resolve();
    expect(document.title).toBe('(1) Urna Abierta');
    expect(badge).toBe(1);
    watch.leave(turn);
    await Promise.resolve();
    expect(document.title).toBe('Urna Abierta');
    expect(badge).toBe(0);
  });

  it('a refresh that arrives after the panel left changes nothing, and neither does an earlier panel leaving late', async () => {
    const watch = new AlertWatch();
    const first = watch.watch();
    watch.update(first, 'e-1', []);
    watch.leave(first);
    watch.update(first, 'e-1', ['a-1', 'a-2']);
    await Promise.resolve();
    expect(document.title).toBe('Urna Abierta');
    expect(badge).toBe(0);
    expect(rung).toBe(0);
    // The panel opens again: the one that left before cannot undo what it shows.
    const second = watch.watch();
    watch.update(second, 'e-1', ['a-1']);
    watch.leave(first);
    await Promise.resolve();
    expect(document.title).toBe('(1) Urna Abierta');
    expect(badge).toBe(1);
  });
});
