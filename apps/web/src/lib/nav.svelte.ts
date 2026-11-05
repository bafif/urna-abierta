export interface Place {
  name: string;
  params: Record<string, any>;
}

/** Moves between screens. Tied to the browser history, so the phone's back button does what anyone expects. */
class Nav {
  private stack = $state.raw<Place[]>([{ name: 'home', params: {} }]);

  constructor() {
    addEventListener('popstate', () => {
      if (this.stack.length > 1) this.stack = this.stack.slice(0, -1);
    });
  }

  get current(): Place {
    return this.stack[this.stack.length - 1]!;
  }

  go(name: string, params: Record<string, any> = {}): void {
    this.stack = [...this.stack, { name, params }];
    history.pushState(null, '');
  }

  /** Goes to a screen without leaving the current one behind: back will not return to it. */
  replace(name: string, params: Record<string, any> = {}): void {
    this.stack = [...this.stack.slice(0, -1), { name, params }];
  }

  back(): void {
    if (this.stack.length > 1) history.back();
  }

  /** Back to the start, for when a task ends. */
  home(): void {
    const steps = this.stack.length - 1;
    if (steps > 0) history.go(-steps);
    this.stack = [{ name: 'home', params: {} }];
  }
}

export const nav = new Nav();
