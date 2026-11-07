<script lang="ts">
  import { onMount } from 'svelte';
  import Ic from '../components/Ic.svelte';
  import Pantalla from '../components/Pantalla.svelte';
  import Stations, { type Station } from '../components/Stations.svelte';
  import { formatRange, t } from '../i18n.svelte.ts';
  import { nav } from '../nav.svelte.ts';
  import { session } from '../session.svelte.ts';
  import type { ElectionSummary } from '../types.ts';

  let { id }: { id: string } = $props();
  let election = $state.raw<ElectionSummary | null>(null);
  let failed = $state(false);
  /** What arrived after the close and nobody looked at yet. */
  let late = $state(0);

  const load = async () => {
    election = (await session.api<{ elections: ElectionSummary[] }>('/elections')).elections.find((item) => item.id === id) ?? null;
    late = election?.status === 'cerrada' ? (await session.api<{ items: unknown[] }>(`/elections/${id}/late`)).items.length : 0;
  };
  onMount(load);

  const ORDER = ['roll', 'tables', 'fiscales', 'open', 'running', 'counting', 'closed', 'purged'] as const;
  const now = $derived.by((): (typeof ORDER)[number] => {
    if (!election) return 'roll';
    if (election.status === 'purgada') return 'purged';
    if (election.status === 'cerrada') return 'closed';
    if (election.status === 'escrutinio') return 'counting';
    if (election.status === 'jornada') return 'running';
    if (election.people === 0) return 'roll';
    if (election.without_table > 0 || election.tables === 0) return 'tables';
    if (election.tables_without_fiscal > 0) return 'fiscales';
    return 'open';
  });

  const stations = $derived.by((): Station[] => {
    const position = ORDER.indexOf(now);
    const state = (...keys: (typeof ORDER)[number][]): Station['state'] => {
      if (keys.includes(now)) return 'ahora';
      return ORDER.indexOf(keys[keys.length - 1]!) < position ? 'hecho' : '';
    };
    const e = election!;
    return [
      { text: t('election.st.roll'), when: e.people ? t('election.st.people', { count: e.people }) : t('election.st.roll.when'), state: state('roll'), help: t('election.st.roll.help') },
      { text: t('election.st.tables'), when: e.tables ? t('election.st.tablesCount', { count: e.tables }) : t('election.st.tables.when'), state: state('tables'), help: t('election.st.tables.help') },
      { text: t('election.st.fiscales'), when: e.tables && e.tables_without_fiscal ? t('election.st.fiscalesMissing', { count: e.tables_without_fiscal }) : t('election.st.fiscales.when'), state: state('fiscales'), help: t('election.st.fiscales.help') },
      { text: t('election.st.day'), when: formatRange(e.days), state: state('open', 'running'), help: now === 'open' ? t('election.st.open.help') : t('election.st.running.help') },
      { text: t('election.st.count'), when: t('election.st.count.when'), state: state('counting'), help: t('election.st.count.help') },
      { text: t('election.st.close'), when: t('election.st.close.when'), state: state('closed'), help: t('election.st.close.help') },
    ];
  });

  async function advance(status: string) {
    if (!confirm(t(`election.confirm.${status}` as Parameters<typeof t>[0]))) return;
    failed = false;
    try {
      await session.api(`/elections/${id}/status`, { method: 'POST', body: { status } });
      await load();
    } catch {
      failed = true;
    }
  }

  async function purge() {
    if (!confirm(t('election.confirm.purge'))) return;
    failed = false;
    try {
      await session.api(`/elections/${id}/purge`, { method: 'POST' });
      await load();
    } catch {
      failed = true;
    }
  }
</script>

{#if election}
  <Pantalla accion="eleccion" volver ojo={formatRange(election.days)} titulo={election.name} desliza>
    <Stations steps={stations} />
    {#if election.to_review > 0}
      <button class="enlace" onclick={() => nav.go('review', { election: id })}>{t('election.toReview', { count: election.to_review })}</button>
    {/if}
    {#if late > 0}
      <button class="enlace" data-testid="late-link" onclick={() => nav.go('late', { election: id })}>{t('late.link', { count: late })}</button>
    {/if}
    {#if failed}<p class="problema" role="alert">{t('error.tryAgain')}</p>{/if}
    <!-- What comes next stays at the bottom. The rest is here, for whoever goes looking for it. -->
    <div class="renglon-botones separado">
      {#if election.people && now !== 'tables'}<button class="enlace" onclick={() => nav.go('tables', { election: id })}>{t('election.seeTables')}</button>{/if}
      {#if election.tables}<button class="enlace" onclick={() => nav.go('districts', { election: id })}>{t('election.districts')}</button>{/if}
      {#if election.tables && election.status !== 'purgada'}<button class="enlace" data-testid="schedule-link" onclick={() => nav.go('schedule', { election: id })}>{t('schedule.open')}</button>{/if}
      {#if election.status !== 'purgada'}<button class="enlace" data-testid="edit-election" onclick={() => nav.go('electionEdit', { id })}>{t('electionEdit.eyebrow')}</button>{/if}
      {#if election.people && !['cerrada', 'purgada'].includes(election.status)}<button class="enlace" onclick={() => nav.go('rollUpload', { election: id })}>{t('election.reupload')}</button>{/if}
      {#if ['jornada', 'escrutinio', 'cerrada'].includes(election.status)}<button class="enlace" onclick={() => nav.go('numbers', { election: id })}>{t('election.numbers')}</button>{/if}
      {#if ['jornada', 'escrutinio', 'cerrada'].includes(election.status)}<button class="enlace" data-testid="results-link" onclick={() => nav.go('results', { election: id })}>{t('results.open')}</button>{/if}
    </div>
    {#snippet pie()}
      <div class="pila">
        {#if now === 'roll'}
          <button class="boton primario" onclick={() => nav.go('rollUpload', { election: id })}><Ic name="flecha" /><span>{t('election.upload')}</span></button>
        {:else if now === 'tables'}
          <button class="boton primario" onclick={() => nav.go('tables', { election: id })}><Ic name="flecha" /><span>{t('election.seeTables')}</span></button>
        {:else if now === 'fiscales'}
          <button class="boton primario" onclick={() => nav.go('fiscales', { election: id })}><Ic name="flecha" /><span>{t('election.seeFiscales')}</span></button>
        {:else if now === 'open'}
          <button class="boton primario" onclick={() => advance('jornada')}><Ic name="flecha" /><span>{t('election.open')}</span></button>
          <button class="enlace" onclick={() => nav.go('fiscales', { election: id })}>{t('election.seeFiscales')}</button>
        {:else if now === 'running'}
          <button class="boton primario" onclick={() => nav.go('district', { election: id })}><Ic name="flecha" /><span>{t('election.watch')}</span></button>
          <button class="enlace" onclick={() => advance('escrutinio')}>{t('election.toCount')}</button>
        {:else if now === 'counting'}
          <button class="boton primario" onclick={() => nav.go('district', { election: id })}><Ic name="flecha" /><span>{t('election.watch')}</span></button>
          <button class="enlace" onclick={() => advance('cerrada')}>{t('election.toClose')}</button>
        {:else if now === 'closed'}
          <button class="boton peligro" onclick={purge}>{t('election.purge')}</button>
        {/if}
      </div>
    {/snippet}
  </Pantalla>
{:else}
  <Pantalla volver />
{/if}
