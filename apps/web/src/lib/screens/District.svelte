<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import Ic from '../components/Ic.svelte';
  import Pantalla from '../components/Pantalla.svelte';
  import { t, timeAgo } from '../i18n.svelte.ts';
  import { alertWatch } from '../alerts.ts';
  import { localDay } from '../app.svelte.ts';
  import { nav } from '../nav.svelte.ts';
  import { session } from '../session.svelte.ts';

  interface ElectionRef {
    id: string;
    name: string;
    status: string;
    days: string[];
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
  }

  const REFRESH_MS = 20_000;
  /** While an alert is open, more often: the server keeps the panel this long anyway. */
  const ALERT_REFRESH_MS = 10_000;
  /** Past this, a table is worth a call. It may only be missing signal, and the screen says so. */
  const SILENT_MS = 30 * 60_000;

  let { election: given }: { election?: string } = $props();

  let election = $state<ElectionRef | null>(null);
  let tables = $state.raw<Table[]>([]);
  let offline = $state(false);
  let loaded = $state(false);
  let showAll = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let gone = false;

  async function load() {
    try {
      if (!election) {
        const { elections } = await session.api<{ elections: ElectionRef[] }>('/district/elections');
        election = (given ? elections.find((item) => item.id === given) : elections.find((item) => item.status === 'jornada') ?? elections[0]) ?? null;
      }
      if (election) {
        tables = (await session.api<{ tables: Table[] }>(`/district/${election.id}`)).tables;
        alertWatch.update(election.id, tables.flatMap((table) => table.incidents.map((incident) => incident.id)));
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
    void load().then(again);
    document.addEventListener('visibilitychange', back);
  });
  onDestroy(() => {
    gone = true;
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', back);
    alertWatch.leave();
  });

  /** Only while it is being voted: at night, or once its day was closed, silence says nothing. */
  const silent = (table: Table) =>
    election?.status === 'jornada' && election.days.includes(localDay()) && !table.countedDays.includes(localDay()) && (!table.lastSync || Date.now() - Date.parse(table.lastSync) > SILENT_MS);
  const needsSomeone = (table: Table) => table.incidents.length > 0 || table.envelopesDiffer || table.talliesDiffer || silent(table);
  const needing = $derived(tables.filter(needsSomeone));
  const fine = $derived(tables.filter((table) => !needsSomeone(table)));
  const title = $derived(!loaded ? '' : !election ? t('district.noElection') : needing.length === 0 ? t('district.allGood') : t('district.need', { count: needing.length }));
</script>

<Pantalla accion="aviso" volver={Boolean(given)} ojo={election ? t('district.eyebrow', { name: election.name, count: tables.length }) : ''} titulo={title} desliza>
  {#if offline}<p class="estado envio"><span class="foco"></span>{t('district.offline')}</p>{/if}
  <div class="tarjetas">
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
        {:else}
          <strong>{t('district.silent', { table: table.name })}</strong>
          <span>{table.lastSync ? timeAgo(table.lastSync) : t('district.never')} · {t('district.silent.text')}</span>
        {/if}
      </button>
    {/each}
  </div>
  {#if fine.length > 0}
    <p class="resultado bien"><Ic name="tilde" />{t('district.othersFine', { count: fine.length })}</p>
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
    {#if !given}<button class="enlace" onclick={() => nav.go('settings')}>{t('plan.settings')}</button>{/if}
  {/snippet}
</Pantalla>
