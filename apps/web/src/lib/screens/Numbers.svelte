<script lang="ts">
  import { onMount } from 'svelte';
  import Pantalla from '../components/Pantalla.svelte';
  import { i18n, t } from '../i18n.svelte.ts';
  import { nav } from '../nav.svelte.ts';
  import { autoPick, statusName, type OpenElection } from '../open-elections.ts';
  import { session } from '../session.svelte.ts';

  interface Stats {
    people: number;
    voted: number;
    share: number;
    tables: { name: string; share: number }[];
    hours: { hour: string; marks: number }[];
  }

  let { election: given }: { election?: string } = $props();
  let elections = $state.raw<OpenElection[]>([]);
  let name = $state('');
  let pickedId = $state('');
  let stats = $state.raw<Stats | null>(null);
  let problem = $state(false);
  /** With several elections and none clearly under way, the person says which one. */
  let choosing = $state(false);

  async function show(picked: OpenElection | undefined | null) {
    choosing = !picked && elections.length > 1;
    name = picked?.name ?? '';
    pickedId = picked?.id ?? '';
    stats = null;
    problem = false;
    try {
      if (picked) stats = await session.api<Stats>(`/elections/${picked.id}/stats`);
    } catch {
      problem = true;
    }
  }

  onMount(async () => {
    try {
      elections = (await session.api<{ elections: OpenElection[] }>('/open-elections')).elections;
    } catch {
      problem = true;
      return;
    }
    await show(given ? elections.find((item) => item.id === given) : autoPick(elections));
  });

  const peak = $derived(Math.max(1, ...(stats?.hours.map((hour) => hour.marks) ?? [])));
  const hourName = (hour: string) => new Date(hour).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' });
</script>

{#if choosing}
  <Pantalla accion="plan" titulo={t('numbers.pick')} desliza>
    <div class="tarjetas">
      {#each elections as election (election.id)}
        <button class="tarjeta eleccion" data-testid="pick-election" onclick={() => show(election)}>
          <strong>{election.name}</strong>
          <span>{t(statusName(election.status))}</span>
        </button>
      {/each}
    </div>
    {#snippet pie()}
      <button class="enlace" onclick={() => nav.go('settings')}>{t('plan.settings')}</button>
    {/snippet}
  </Pantalla>
{:else}
  <Pantalla accion="plan" volver={Boolean(given) || elections.length > 1} onback={given ? undefined : () => (choosing = true)} ojo={name} desliza>
    {#snippet encabezado()}
      {#if stats}
        <span class="faltan" data-testid="share">{stats.share} %</span>
        <span class="de">{t('numbers.voted', { voted: stats.voted, people: stats.people })}</span>
      {:else if problem}
        {t('error.tryAgain')}
      {/if}
    {/snippet}
    {#if stats}
      {#if stats.tables.length > 0}
        <p class="etiqueta">{t('numbers.byTable')}</p>
        <div class="barras">
          {#each stats.tables as table}
            <div class="barra"><span>{table.name}</span><i style="--v:{table.share}%"></i><b>{table.share} %</b></div>
          {/each}
        </div>
      {/if}
      {#if stats.hours.length > 0}
        <p class="etiqueta">{t('numbers.byHour')}</p>
        <div class="barras">
          {#each stats.hours as hour}
            <div class="barra"><span>{hourName(hour.hour)}</span><i style="--v:{Math.round((hour.marks / peak) * 100)}%"></i><b>{hour.marks}</b></div>
          {/each}
        </div>
      {/if}
      <p class="aclara">{t('numbers.note')}</p>
      <button class="enlace" data-testid="results-link" onclick={() => nav.go('results', { election: pickedId })}>{t('results.open')}</button>
    {/if}
    {#snippet pie()}
      {#if !given}<button class="enlace" onclick={() => nav.go('settings')}>{t('plan.settings')}</button>{/if}
    {/snippet}
  </Pantalla>
{/if}
