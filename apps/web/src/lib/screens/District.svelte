<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import Ic from '../components/Ic.svelte';
  import Pantalla from '../components/Pantalla.svelte';
  import { t, timeAgo } from '../i18n.svelte.ts';
  import { alertWatch } from '../alerts.ts';
  import { localDay } from '../app.svelte.ts';
  import { nav } from '../nav.svelte.ts';
  import { session } from '../session.svelte.ts';
  import { timeIn } from '../schedule.ts';

  interface ElectionRef {
    id: string;
    name: string;
    status: string;
    days: string[];
    categories: { id: string; name: string }[];
    hours?: Record<string, { open: string; close: string }>;
    time_zone?: string;
  }
  interface Table {
    id: string;
    name: string;
    place: string;
    total: number;
    voted: number;
    lastSync: string | null;
    fiscal: { name: string; phone: string | null } | null;
    incidents: { id: string; at: string; kind: string }[];
    countedDays: string[];
    envelopesDiffer: boolean;
    talliesDiffer: boolean;
    /** When each day was closed there, by its first envelope count. */
    countedAt: Record<string, string>;
    tallied: string[];
    photo: boolean;
  }

  const REFRESH_MS = 20_000;
  /** While an alert is open, more often: the server keeps the panel this long anyway. */
  const ALERT_REFRESH_MS = 10_000;
  /** Past this, a table is worth a call. It may only be missing signal, and the screen says so. */
  const SILENT_MS = 30 * 60_000;
  /** An hour after a table closed its last day, a missing tally or photo is worth a call. */
  const LOADING_MS = 60 * 60_000;

  let { election: given }: { election?: string } = $props();

  let election = $state<ElectionRef | null>(null);
  let tables = $state.raw<Table[]>([]);
  let offline = $state(false);
  let loaded = $state(false);
  let showAll = $state(false);
  /** What arrived after the close and nobody looked at yet. */
  let late = $state(0);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let gone = false;
  /** What a refresh brings after this panel left does not reach the icon or the title. */
  let turn = 0;

  async function load() {
    try {
      if (!election) {
        const { elections } = await session.api<{ elections: ElectionRef[] }>('/district/elections');
        election = (given ? elections.find((item) => item.id === given) : elections.find((item) => item.status === 'jornada') ?? elections[0]) ?? null;
      }
      if (election) {
        tables = (await session.api<{ tables: Table[] }>(`/district/${election.id}`)).tables;
        if (election.status === 'cerrada') late = (await session.api<{ items: unknown[] }>(`/elections/${election.id}/late`)).items.length;
        alertWatch.update(turn, election.id, tables.flatMap((table) => table.incidents.map((incident) => incident.id)));
      }
      offline = false;
    } catch {
      offline = true;
    }
    loaded = true;
  }

  /** Also while the app is in the background, so that the icon and the title keep up. */
  function again() {
    clearTimeout(timer);
    if (gone) return;
    timer = setTimeout(async () => {
      await load();
      again();
    }, tables.some((table) => table.incidents.length > 0) ? ALERT_REFRESH_MS : REFRESH_MS);
  }

  function back() {
    if (document.visibilityState === 'visible') void load().then(again);
  }

  onMount(() => {
    turn = alertWatch.watch();
    void load().then(again);
    document.addEventListener('visibilitychange', back);
  });
  onDestroy(() => {
    gone = true;
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', back);
    alertWatch.leave(turn);
  });

  /** Only while it is being voted, inside its hours when the election says them: at night, or once its day was closed, silence says nothing. */
  const open = () => {
    const hours = election?.hours?.[localDay()];
    if (!hours) return true;
    const now = timeIn(election?.time_zone);
    return now >= hours.open && now < hours.close;
  };
  const silent = (table: Table) =>
    election?.status === 'jornada' && election.days.includes(localDay()) && open() && !table.countedDays.includes(localDay()) && (!table.lastSync || Date.now() - Date.parse(table.lastSync) > SILENT_MS);
  const lastDay = $derived(election?.days.at(-1) ?? '');
  /** Past the close of the last day the panel is about the count: which tables still owe it, and how many loaded everything. */
  const counting = $derived(
    Boolean(election) &&
      (['escrutinio', 'cerrada'].includes(election!.status) ||
        (election!.status === 'jornada' && lastDay !== '' && (localDay() > lastDay || (localDay() === lastDay && tables.some((table) => table.countedDays.includes(lastDay)))))),
  );
  /** The first table to close the last day marks the close for the ones that have not said anything. */
  const firstClose = $derived(Math.min(...tables.map((table) => Date.parse(table.countedAt[lastDay] ?? '')).filter(Number.isFinite)));
  /** Every category tallied, and no two versions waiting. The photo is asked for apart. */
  const complete = (table: Table) => !table.talliesDiffer && (election?.categories ?? []).every((category) => table.tallied.includes(category.id));
  const overdue = (table: Table) => {
    const closed = Date.parse(table.countedAt[lastDay] ?? '') || firstClose;
    return Number.isFinite(closed) ? Date.now() - closed > LOADING_MS : localDay() > lastDay;
  };
  const noTally = (table: Table) => !complete(table) && !table.talliesDiffer && overdue(table);
  const noPhoto = (table: Table) => complete(table) && !table.photo && overdue(table);
  const needsSomeone = (table: Table) =>
    table.incidents.length > 0 || table.envelopesDiffer || table.talliesDiffer || silent(table) || (counting && (noTally(table) || noPhoto(table)));
  const needing = $derived(tables.filter(needsSomeone));
  const fine = $derived(tables.filter((table) => !needsSomeone(table)));
  const done = $derived(tables.filter(complete).length);
  const fineDone = $derived(fine.filter(complete).length);
  const title = $derived(
    !loaded ? '' : !election ? t('district.noElection') : needing.length > 0 ? t('district.need', { count: needing.length }) : counting && done === tables.length ? t('district.counting.all') : t('district.allGood'),
  );
</script>

<Pantalla accion="aviso" volver={Boolean(given)} ojo={election ? t(counting ? 'district.counting.eyebrow' : 'district.eyebrow', { name: election.name, count: tables.length }) : ''} titulo={title} desliza>
  {#if offline}<p class="estado envio"><span class="foco"></span>{t('district.offline')}</p>{/if}
  {#if counting && tables.length > 0}
    <div class="barras">
      <div class="barra" data-testid="count-progress"><span>{t('district.counting.bar')}</span><i style="--v:{Math.round((done / tables.length) * 100)}%"></i><b>{t('district.counting.of', { done, count: tables.length })}</b></div>
    </div>
  {/if}
  <div class="tarjetas">
    {#if late > 0 && election}
      <button class="tarjeta" data-testid="late-link" onclick={() => nav.go('late', { election: election!.id })}><strong>{t('late.link', { count: late })}</strong><span>{t('late.text')}</span></button>
    {/if}
    {#each needing as table (table.id)}
      <button class="tarjeta" class:alerta={table.incidents.length > 0} data-testid="needs" onclick={() => nav.go('tableDetail', { table: table.id })}>
        {#if table.incidents.length > 0}
          <strong>{t('district.urgent', { table: table.name })}</strong>
          <span>{table.fiscal?.name ?? ''} · {timeAgo(table.incidents[0]!.at)}</span>
        {:else if table.talliesDiffer}
          <strong>{t('district.talliesDiffer', { table: table.name })}</strong>
          <span>{t('district.talliesDiffer.text')}</span>
        {:else if table.envelopesDiffer}
          <strong>{t('district.envelopesDiffer', { table: table.name })}</strong>
          <span>{t('district.envelopesDiffer.text')}</span>
        {:else if counting && noTally(table)}
          <strong>{t('district.noTally', { table: table.name })}</strong>
          <span>{table.fiscal?.name ?? ''} · {table.lastSync ? timeAgo(table.lastSync) : t('district.never')}</span>
        {:else if counting && noPhoto(table)}
          <strong>{t('district.noPhoto', { table: table.name })}</strong>
          <span>{t('district.noPhoto.text')}</span>
        {:else}
          <strong>{t('district.silent', { table: table.name })}</strong>
          <span>{table.lastSync ? timeAgo(table.lastSync) : t('district.never')} · {t('district.silent.text')}</span>
        {/if}
      </button>
    {/each}
  </div>
  {#if fine.length > 0}
    {#if !counting}
      <p class="resultado bien"><Ic name="tilde" />{t('district.othersFine', { count: fine.length })}</p>
    {:else}
      {#if fineDone > 0}<p class="resultado bien"><Ic name="tilde" />{t('district.counting.done', { count: fineDone })}</p>{/if}
      {#if fine.length > fineDone}<p class="aclara">{t('district.counting.waiting', { count: fine.length - fineDone })}</p>{/if}
    {/if}
    <button class="enlace" onclick={() => (showAll = !showAll)}>{showAll ? t('district.hide') : t('district.showAll')}</button>
    {#if showAll}
      <div class="tarjetas compactas">
        {#each fine as table (table.id)}
          <button class="tarjeta fila-mesa" onclick={() => nav.go('tableDetail', { table: table.id })}>
            <strong>{table.name}</strong><span>{t('district.progress', { voted: table.voted, total: table.total })}</span>
          </button>
        {/each}
      </div>
    {/if}
  {/if}
  {#snippet pie()}
    <div class="pila">
      {#if counting && election}<button class="boton secundario" data-testid="see-totals" onclick={() => nav.go('results', { election: election!.id })}>{t('district.totals')}</button>{/if}
      {#if election}<button class="enlace" data-testid="schedule-link" onclick={() => nav.go('schedule', { election: election!.id })}>{t('schedule.open')}</button>{/if}
      {#if !given}<button class="enlace" onclick={() => nav.go('settings')}>{t('plan.settings')}</button>{/if}
    </div>
  {/snippet}
</Pantalla>
