import type { MessageKey } from './i18n.svelte.ts';

/** An election someone working with numbers or the traffic light can pick: its name and where it is. */
export interface OpenElection {
  id: string;
  name: string;
  status: string;
}

/** The one to open without asking: the only one, or the only one being voted or counted. With several, the person picks. */
export function autoPick(elections: readonly OpenElection[]): OpenElection | null {
  if (elections.length === 1) return elections[0]!;
  const live = elections.filter((election) => election.status === 'jornada' || election.status === 'escrutinio');
  return live.length === 1 ? live[0]! : null;
}

const STATUS_NAMES: Record<string, MessageKey> = {
  preparacion: 'elections.preparing',
  jornada: 'elections.running',
  escrutinio: 'elections.counting',
  cerrada: 'elections.closed',
};

export const statusName = (status: string): MessageKey => STATUS_NAMES[status] ?? 'elections.closed';
