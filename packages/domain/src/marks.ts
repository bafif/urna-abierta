import type { Operation } from './operations.ts';

/**
 * Who voted, as a set where adding wins: a person voted if at least one mark has not been
 * cancelled. Undoing cancels only the marks that phone had seen, so a mark made at the same
 * time by another fiscal survives. Nothing here depends on the clock of any phone, and the
 * result is the same whatever the order in which operations arrive, or if they repeat.
 */
export class MarkState {
  private readonly marks = new Map<string, Set<string>>();
  private readonly cancelled = new Set<string>();

  apply(operation: Operation): void {
    if (operation.type === 'voter.marked') {
      let ids = this.marks.get(operation.payload.elector);
      if (!ids) {
        ids = new Set();
        this.marks.set(operation.payload.elector, ids);
      }
      ids.add(operation.id);
    } else if (operation.type === 'voter.unmarked') {
      for (const id of operation.payload.cancels) this.cancelled.add(id);
    }
  }

  /** The marks of a person that are still standing. An undo has to name exactly these. */
  activeMarks(elector: string): string[] {
    const ids = this.marks.get(elector);
    return ids ? [...ids].filter((id) => !this.cancelled.has(id)) : [];
  }

  hasVoted(elector: string): boolean {
    return this.activeMarks(elector).length > 0;
  }

  voters(): string[] {
    return [...this.marks.keys()].filter((elector) => this.hasVoted(elector)).sort();
  }
}
