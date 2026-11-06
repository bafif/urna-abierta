import { resolve } from '$app/paths';
import { ui, type Theme } from './ui.svelte.ts';

export const API = `${resolve('/')}api`;
const TOKEN_KEY = 'urna-abierta-token';
const ME_KEY = 'urna-abierta-me';
const INVITATION_KEY = 'urna-abierta-invitacion';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    /** What the server could not read in a file. Its shape depends on the route: each screen checks what it expects. */
    readonly problems: unknown[] = [],
  ) {
    super(code);
  }
}

export interface TableInfo {
  id: string;
  name: string;
  place: string;
  election: string;
  electionId: string;
  status: string;
  days: string[];
  /** The days this person works. Without it, all of them. */
  shift: string[] | null;
  categories: { id: string; name: string; lists: { id: string; name: string }[] }[];
  total: number;
}

export interface Me {
  user: { id: string; name: string };
  roles: string[];
  main: string | null;
  secondFactorNeeded: boolean;
  party: { name: string; theme: string };
  security: { profile: string; chosen: boolean; fiscalSeesSemaphore: boolean; fiscalView: boolean; localHoursAfterClose?: number };
  table: TableInfo | null;
  contact: { name: string; phone: string | null } | null;
}

function read<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}

class Session {
  ready = $state(false);
  token = $state<string | null>(localStorage.getItem(TOKEN_KEY));
  me = $state.raw<Me | null>(read<Me>(ME_KEY));
  setupNeeded = $state(false);
  setupCode = $state('');
  /** The invitation could not be used: 'used', or 'no_signal' while it can still be tried again. */
  invitationProblem = $state<'used' | 'no_signal' | null>(null);
  /** This device had access and it was taken away. */
  revoked = $state(false);
  /** The server could not be reached and there is nothing saved to work with. */
  unreachable = $state(false);

  /** Requests with this device's credential. Every part of the app that talks to the server goes through here. */
  fetch: typeof fetch = async (input, init = {}) => {
    const headers = new Headers(init.headers);
    if (this.token) headers.set('authorization', `Bearer ${this.token}`);
    const response = await fetch(input, { ...init, headers });
    if (response.status === 401 && this.token) this.revoked = true;
    return response;
  };

  async api<T = any>(path: string, { method = 'GET', body, raw, type }: { method?: string; body?: unknown; raw?: BodyInit; type?: string } = {}): Promise<T> {
    const response = await this.fetch(`${API}${path}`, {
      method,
      signal: AbortSignal.timeout(raw ? 120_000 : 20_000),
      ...(raw !== undefined ? { body: raw, headers: { 'content-type': type ?? 'application/octet-stream' } } : {}),
      ...(body !== undefined ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new ApiError(response.status, data.error ?? 'failed', data.problems);
    return data as T;
  }

  private setToken(token: string): void {
    this.token = token;
    this.revoked = false;
    localStorage.setItem(TOKEN_KEY, token);
  }

  async start(): Promise<void> {
    const hash = new URLSearchParams(location.hash.slice(1));
    const invitation = hash.get('invitacion');
    if (invitation) localStorage.setItem(INVITATION_KEY, invitation);
    this.setupCode = hash.get('setup') ?? '';
    // The link does not stay in the address or in the history.
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
    await this.usePendingInvitation();
    await this.refresh();
    this.ready = true;
  }

  /** Separate from the start, so that it can be tried again once there is signal. */
  async usePendingInvitation(): Promise<void> {
    const invitation = localStorage.getItem(INVITATION_KEY);
    if (!invitation) return;
    try {
      await this.redeem(invitation);
      this.invitationProblem = null;
      localStorage.removeItem(INVITATION_KEY);
    } catch (error) {
      const refused = error instanceof ApiError && error.status === 410;
      this.invitationProblem = refused ? 'used' : 'no_signal';
      if (refused) localStorage.removeItem(INVITATION_KEY);
    }
  }

  /** An invitation link or the short code of another device. */
  async redeem(token: string): Promise<void> {
    const { token: device } = await this.api<{ token: string }>('/auth/redeem', { method: 'POST', body: { token } });
    this.setToken(device);
  }

  async setup(details: { code: string; name: string; phone: string; accepted: boolean }): Promise<void> {
    const { token } = await this.api<{ token: string }>('/setup', { method: 'POST', body: details });
    this.setToken(token);
    this.setupNeeded = false;
    await this.refresh();
  }

  async refresh(): Promise<void> {
    try {
      const open = await this.api<{ setupNeeded: boolean; party: { theme: string }; themes: Theme[] }>('/public');
      this.setupNeeded = open.setupNeeded;
      ui.usePartySettings(open.party, open.themes);
      this.unreachable = false;
    } catch {
      this.unreachable = !this.me;
    }
    if (!this.token) return;
    try {
      this.me = await this.api<Me>('/me');
      localStorage.setItem(ME_KEY, JSON.stringify(this.me));
    } catch (error) {
      // Without signal, what was saved is enough. Only a refusal from the server changes anything.
      if (error instanceof ApiError && error.status === 401) this.revoked = true;
    }
  }

  can(...roles: string[]): boolean {
    return roles.some((role) => this.me?.roles.includes(role));
  }

  /** Forgets this device's access, so that another invitation can be used. Saved marks stay. */
  forget(): void {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ME_KEY);
    this.token = null;
    this.me = null;
    this.revoked = false;
  }
}

export const session = new Session();

export const inviteLink = (token: string) => `${location.origin}${resolve('/')}#invitacion=${token}`;
