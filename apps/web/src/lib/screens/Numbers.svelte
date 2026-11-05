<script lang="ts">
  import { onMount } from 'svelte';
  import Pantalla from '../components/Pantalla.svelte';
  import { i18n, t } from '../i18n.svelte.ts';
  import { nav } from '../nav.svelte.ts';
  import { session } from '../session.svelte.ts';

  interface Stats {
    people: number;
    voted: number;
    share: number;
    tables: { name: string; share: number }[];
    hours: { hour: string; marks: number }[];
  }

  let { election: given }: { election?: string } = $props();
  let name = $state('');
  let stats = $state.raw<Stats | null>(null);
  let problem = $state(false);

  onMount(async () => {
    try {
      const { elections } = await session.api<{ elections: { id: string; name: string; status: string }[] }>('/open-elections');
      const picked = given ? elections.find((item) => item.id === given) : (elections.find((item) => item.status === 'jornada') ?? elections[0]);
      name = picked?.name ?? '';
      if (picked) stats = await session.api<Stats>(`/elections/${picked.id}/stats`);
    } catch {
      problem = true;
    }
  });

  const peak = $derived(Math.max(1, ...(stats?.hours.map((hour) => hour.marks) ?? [])));
  const hourName = (hour: string) => new Date(hour).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' });
</script>

<Pantalla accion="plan" volver={Boolean(given)} ojo={name} desliza>
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
  {/if}
  {#snippet pie()}
    {#if !given}<button class="enlace" onclick={() => nav.go('settings')}>{t('plan.settings')}</button>{/if}
  {/snippet}
</Pantalla>
