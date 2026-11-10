<script lang="ts">
  import { onMount } from 'svelte';
  import { whatsappDigits } from '@urna-abierta/domain';
  import Ic from '../components/Ic.svelte';
  import Options from '../components/Options.svelte';
  import Pantalla from '../components/Pantalla.svelte';
  import { formatDay, formatRange, roleName, t } from '../i18n.svelte.ts';
  import { nav } from '../nav.svelte.ts';
  import { inviteLink, session } from '../session.svelte.ts';
  import type { ElectionSummary } from '../types.ts';

  interface Fiscal {
    id: string;
    name: string;
    days: string[] | null;
    /** Their task at this table, to take them off it. */
    assignment: string;
  }
  interface Table {
    id: string;
    name: string;
    fiscales: Fiscal[];
  }
  /** Someone in the team, with what they already do. */
  interface Member {
    id: string;
    name: string;
    roles: { role: string; table: string | null; tableName: string | null; days: string[] | null }[];
  }
  interface Candidate {
    id: string;
    title: string;
    detail: string;
    /** The days they are not at another table of this election. */
    free: string[];
    rank: number;
  }
  interface Pending {
    name: string;
    phone: string | null;
    table: string;
    invitation: string;
  }

  let { election }: { election: string } = $props();
  let tables = $state.raw<Table[]>([]);
  let electionDays = $state.raw<string[]>([]);
  let pending = $state.raw<Pending[] | null>(null);
  let loaded = $state(false);
  let copied = $state(false);
  /** The table being filled: whoever is already in the team comes first, and someone new after. */
  let filling = $state.raw<Table | null>(null);
  let team = $state.raw<Member[]>([]);
  let chosen = $state<string | null>(null);
  let shift = $state<string[]>([]);
  let done = $state('');
  let failed = $state(false);

  async function load() {
    const [listed, all] = await Promise.all([
      session.api<{ tables: Table[] }>(`/elections/${election}/tables`),
      session.api<{ elections: ElectionSummary[] }>('/elections'),
    ]);
    tables = listed.tables;
    electionDays = all.elections.find((item) => item.id === election)?.days ?? [];
    loaded = true;
  }
  onMount(load);

  /** A shift with no days covers all of them, and a table is complete when every day has someone. */
  const missingDays = (table: Table) => {
    const covered = new Set(table.fiscales.flatMap((fiscal) => fiscal.days?.map((day) => day.slice(0, 10)) ?? electionDays));
    return electionDays.filter((day) => !covered.has(day));
  };
  const missing = $derived(tables.filter((table) => missingDays(table).length > 0));
  const complete = $derived(tables.filter((table) => missingDays(table).length === 0));
  const manyDays = $derived(electionDays.length > 1);

  function add(table: Table) {
    nav.go('addPerson', { role: 'fiscal', table: table.id, label: t('fiscales.who', { table: table.name }), electionDays, freeDays: missingDays(table) });
  }

  async function fill(table: Table) {
    failed = false;
    done = '';
    chosen = null;
    team = await session.api<{ users: Member[] }>('/users').then((answer) => answer.users).catch(() => []);
    filling = table;
  }

  const dayOf = (day: string) => day.slice(0, 10);

  /**
   * Who could go, the likeliest first: a poll watcher still without a table, then one who goes to another table only
   * some days, then anyone else in the team, who gets this task added. Whoever is at another table every day is not.
   */
  const candidates = $derived.by((): Candidate[] => {
    if (!filling) return [];
    const here = new Set(filling.fiscales.map((fiscal) => fiscal.id));
    const ours = new Set(tables.map((table) => table.id));
    const list: Candidate[] = [];
    for (const member of team) {
      if (here.has(member.id)) continue;
      const watching = member.roles.filter((task) => task.role === 'fiscal');
      const elsewhere = watching.filter((task) => task.table && ours.has(task.table));
      const busy = new Set(elsewhere.flatMap((task) => task.days?.map(dayOf) ?? electionDays));
      const free = electionDays.filter((day) => !busy.has(day));
      if (elsewhere.length > 0 && free.length === 0) continue;
      const others = [...new Set(member.roles.filter((task) => task.role !== 'fiscal').map((task) => roleName(task.role)))].join(', ');
      const [rank, detail]: [number, string] = watching.some((task) => !task.table)
        ? [0, t('fiscales.pick.unplaced')]
        : elsewhere.length > 0
          ? [1, t('fiscales.pick.elsewhere', { table: elsewhere.map((task) => task.tableName).join(', '), days: formatRange([...busy].sort()) })]
          : [2, others ? t('fiscales.pick.adds', { tasks: others }) : t('fiscales.pick.first')];
      list.push({ id: member.id, title: member.name, detail, free, rank });
    }
    return list.sort((a, b) => a.rank - b.rank || a.title.localeCompare(b.title));
  });
  const candidate = $derived(candidates.find((item) => item.id === chosen) ?? null);

  // The days offered are the ones the chosen person is free, and those nobody covers yet come chosen.
  $effect.pre(() => {
    if (!candidate || !filling) return;
    const missingHere = missingDays(filling);
    const wanted = candidate.free.filter((day) => missingHere.includes(day));
    shift = wanted.length > 0 ? wanted : [...candidate.free];
  });
  const toggleDay = (day: string) => {
    shift = shift.includes(day) ? shift.filter((item) => item !== day) : [...shift, day].sort();
  };

  async function assign() {
    if (!filling || !candidate) return;
    const days = manyDays ? shift : electionDays;
    // A second poll watcher on the same day is possible, and not the usual: it asks.
    const covered = new Set(filling.fiscales.flatMap((fiscal) => fiscal.days?.map(dayOf) ?? electionDays));
    const alongside = filling.fiscales[0];
    if (alongside && days.some((day) => covered.has(day)) && !confirm(t('person.another', { table: filling.name, name: alongside.name }))) return;
    failed = false;
    try {
      await session.api(`/users/${candidate.id}/roles`, { method: 'POST', body: { role: 'fiscal', table: filling.id, days: manyDays && shift.length < electionDays.length ? shift : undefined } });
      done = t('fiscales.pick.done', { name: candidate.title, table: filling.name });
      filling = null;
      await load();
    } catch {
      failed = true;
    }
  }

  async function takeOff(fiscal: Fiscal) {
    const table = filling;
    if (!table || !confirm(t('fiscales.pick.removeConfirm', { name: fiscal.name, table: table.name }))) return;
    failed = false;
    try {
      await session.api(`/users/${fiscal.id}/roles/${fiscal.assignment}`, { method: 'DELETE' });
      await load();
      filling = tables.find((item) => item.id === table.id) ?? null;
    } catch {
      failed = true;
    }
  }

  async function inviteAll() {
    pending = (await session.api<{ invitations: Pending[] }>(`/elections/${election}/invitations`, { method: 'POST' })).invitations;
  }

  /** A sheet to copy into a group or a spreadsheet: one line per person with their own link. */
  async function copyAll() {
    await navigator.clipboard.writeText((pending ?? []).map((item) => `${item.table}: ${item.name}: ${inviteLink(item.invitation)}`).join('\n'));
    copied = true;
    setTimeout(() => (copied = false), 3_000);
  }

  const whatsapp = (item: Pending) => `https://wa.me/${whatsappDigits(item.phone)}?text=${encodeURIComponent(t('invite.message', { name: item.name.split(' ')[0] ?? '', party: session.me?.party.name ?? '', link: inviteLink(item.invitation) }))}`;
</script>

{#if filling}
  <Pantalla accion="equipo" volver onback={() => (filling = null)} ojo={filling.name} titulo={t(filling.fiscales.length ? 'fiscales.whoElse' : 'fiscales.who', { table: filling.name })} desliza>
    {#if filling.fiscales.length > 0}
      <div class="tarjetas compactas">
        {#each filling.fiscales as fiscal (fiscal.assignment)}
          <div class="tarjeta fila-mesa" data-testid="fiscal-here">
            <strong>{fiscal.name}</strong>
            {#if manyDays}<span>{fiscal.days?.length ? formatRange(fiscal.days.map(dayOf)) : t('person.task.allDays')}</span>{/if}
            <button class="enlace" onclick={() => takeOff(fiscal)}>{t('fiscales.pick.remove')}</button>
          </div>
        {/each}
      </div>
    {/if}
    {#if candidates.length > 0}
      <p class="etiqueta">{t('fiscales.pick.team')}</p>
      <Options items={candidates} bind:value={chosen} />
    {:else}
      <p class="aviso-suave">{t('fiscales.pick.nobody')}</p>
    {/if}
    {#if candidate && manyDays}
      <p class="etiqueta">{t('person.days')}</p>
      <div class="opciones">
        {#each candidate.free as day (day)}
          <button class="opcion" class:elegida={shift.includes(day)} aria-pressed={shift.includes(day)} data-testid="pick-day" onclick={() => toggleDay(day)}>
            <span class="radio"></span><span><strong>{formatDay(day)}</strong></span>
          </button>
        {/each}
      </div>
    {/if}
    {#if failed}<p class="problema" role="alert">{t('error.tryAgain')}</p>{/if}
    {#snippet pie()}
      <div class="pila">
        {#if candidate}
          <button class="boton primario" disabled={manyDays && shift.length === 0} onclick={assign} data-testid="assign-fiscal"><Ic name="tilde" /><span>{t('fiscales.pick.assign', { name: candidate.title.split(' ')[0] ?? candidate.title })}</span></button>
        {/if}
        <button class={candidate ? 'enlace' : 'boton secundario'} onclick={() => filling && add(filling)}>{t('pick.new')}</button>
      </div>
    {/snippet}
  </Pantalla>
{:else if pending}
  <Pantalla accion="equipo" volver onback={() => (pending = null)} titulo={pending.length ? t('fiscales.links', { count: pending.length }) : t('fiscales.allJoined')} bajada={pending.length ? t('fiscales.links.text') : ''} desliza>
    <div class="tarjetas">
      {#each pending as item (item.invitation)}
        <div class="tarjeta" data-testid="pending-invite">
          <strong>{item.name}</strong>
          <span>{item.table}</span>
          {#if whatsappDigits(item.phone)}<a class="enlace" href={whatsapp(item)}>{t('invite.whatsapp')}</a>{/if}
        </div>
      {/each}
    </div>
    {#snippet pie()}
      {#if pending?.length}<button class="boton secundario" onclick={copyAll}>{copied ? t('invite.copied') : t('fiscales.copyAll')}</button>{/if}
    {/snippet}
  </Pantalla>
{:else}
  <Pantalla accion="equipo" volver ojo={t('fiscales.eyebrow')} titulo={!loaded ? '' : missing.length ? t('fiscales.missing', { count: missing.length }) : t('fiscales.complete')} bajada={manyDays && loaded ? t('fiscales.days') : ''} desliza>
    {#if done}<p class="resultado bien" role="status" data-testid="fiscal-assigned"><Ic name="tilde" />{done}</p>{/if}
    <div class="tarjetas compactas">
      {#each missing as table (table.id)}
        <button class="tarjeta falta" data-testid="table-missing" onclick={() => fill(table)}>
          <strong>{table.name}</strong>
          <span>{table.fiscales.length === 0 ? t('fiscales.none') : t('fiscales.missingDays', { days: missingDays(table).map(formatDay).join(', ') })}</span>
        </button>
      {/each}
      {#each complete as table (table.id)}
        <button class="tarjeta fila-mesa" data-testid="table-covered" onclick={() => fill(table)}><strong>{table.name}</strong><span>{table.fiscales.map((fiscal) => fiscal.name).join(', ')}</span></button>
      {/each}
    </div>
    {#snippet pie()}
      <button class="boton primario" disabled={tables.every((table) => table.fiscales.length === 0)} onclick={inviteAll}><Ic name="sobre" /><span>{t('fiscales.inviteAll')}</span></button>
    {/snippet}
  </Pantalla>
{/if}
