import { describe, expect, it } from 'vitest';
import { autoPick } from '../src/lib/open-elections.ts';

const election = (id: string, status: string) => ({ id, name: `Elección ${id}`, status });

describe('which election the numbers and the traffic light open', () => {
  it('opens the only one, or the only one under way, and asks when that is not clear', () => {
    expect(autoPick([])).toBeNull();
    expect(autoPick([election('a', 'cerrada')])?.id).toBe('a');
    expect(autoPick([election('a', 'cerrada'), election('b', 'jornada'), election('c', 'preparacion')])?.id).toBe('b');
    expect(autoPick([election('a', 'escrutinio'), election('b', 'cerrada')])?.id).toBe('a');
    expect(autoPick([election('a', 'jornada'), election('b', 'jornada')])).toBeNull();
    expect(autoPick([election('a', 'preparacion'), election('b', 'cerrada')])).toBeNull();
  });
});
