import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { MarkState, parseOperation, uuidv7, fakeRoll, foldText, type Operation } from '../src/index.ts';

function operation(type: Operation['type'], payload: object, id = uuidv7()): Operation {
  return {
    id,
    schema: 1,
    table: 'm-1',
    device: 'd-1',
    device_seq: 0,
    device_time: '2027-04-06T12:00:00.000Z',
    type,
    payload,
  } as Operation;
}

function replay(operations: Operation[]): string[] {
  const state = new MarkState();
  for (const item of operations) state.apply(item);
  return state.voters();
}

/** A random history: marks, and undos that name marks already made, as a phone would. */
const history = fc
  .array(fc.record({ elector: fc.integer({ min: 0, max: 5 }), undo: fc.boolean() }), { maxLength: 40 })
  .map((steps) => {
    const made = new Map<string, string[]>();
    const operations: Operation[] = [];
    for (const step of steps) {
      const elector = `e-${step.elector}`;
      const known = made.get(elector) ?? [];
      if (step.undo && known.length > 0) {
        operations.push(operation('voter.unmarked', { elector, cancels: known }));
        made.set(elector, []);
      } else {
        const mark = operation('voter.marked', { elector });
        operations.push(mark);
        made.set(elector, [...known, mark.id]);
      }
    }
    return operations;
  });

describe('MarkState', () => {
  it('a person voted once marked, and no longer after the undo', () => {
    const state = new MarkState();
    const mark = operation('voter.marked', { elector: 'e-1' });
    state.apply(mark);
    expect(state.hasVoted('e-1')).toBe(true);
    state.apply(operation('voter.unmarked', { elector: 'e-1', cancels: [mark.id] }));
    expect(state.hasVoted('e-1')).toBe(false);
  });

  it('an undo does not cancel the mark another fiscal made at the same time', () => {
    const mine = operation('voter.marked', { elector: 'e-1' });
    const theirs = operation('voter.marked', { elector: 'e-1' });
    const undo = operation('voter.unmarked', { elector: 'e-1', cancels: [mine.id] });
    expect(replay([mine, undo, theirs])).toEqual(['e-1']);
    expect(replay([theirs, undo, mine])).toEqual(['e-1']);
  });

  it('an undo that arrives before its mark still cancels it', () => {
    const mark = operation('voter.marked', { elector: 'e-1' });
    const undo = operation('voter.unmarked', { elector: 'e-1', cancels: [mark.id] });
    expect(replay([undo, mark])).toEqual([]);
  });

  it('gives the same result in any order and with repeated operations', () => {
    fc.assert(
      fc.property(
        history.chain((operations) =>
          fc.record({
            operations: fc.constant(operations),
            shuffled: fc.shuffledSubarray(operations, { minLength: operations.length }),
            repeated: fc.array(fc.nat(), { maxLength: 10 }),
          }),
        ),
        ({ operations, shuffled, repeated }) => {
          const noisy = [...shuffled];
          if (operations.length > 0) {
            for (const index of repeated) noisy.push(operations[index % operations.length]!);
          }
          expect(replay(noisy)).toEqual(replay(operations));
        },
      ),
      { numRuns: 500 },
    );
  });
});

describe('operations', () => {
  it('accepts a valid operation and rejects a malformed one', () => {
    expect(parseOperation(operation('voter.marked', { elector: 'e-1' }))).not.toBeNull();
    expect(parseOperation({ ...operation('voter.marked', { elector: 'e-1' }), id: 'x' })).toBeNull();
    expect(parseOperation({ ...operation('voter.marked', { elector: 'e-1' }), type: 'other' })).toBeNull();
    expect(parseOperation(operation('voter.unmarked', { elector: 'e-1', cancels: [] }))).toBeNull();
  });

  it('generates version 7 identifiers that sort by time', () => {
    const first = uuidv7(1_000_000);
    const second = uuidv7(2_000_000);
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(first < second).toBe(true);
  });
});

describe('fake roll', () => {
  it('is reproducible, ordered and searchable without accents', () => {
    const roll = fakeRoll(350, 7);
    expect(roll).toEqual(fakeRoll(350, 7));
    expect(roll.map((entry) => entry.order)).toEqual(Array.from({ length: 350 }, (_, i) => i + 1));
    expect(foldText('Núñez, María José')).toBe('nunez, maria jose');
    expect(roll.some((entry) => entry.search.includes('nunez'))).toBe(true);
  });
});
