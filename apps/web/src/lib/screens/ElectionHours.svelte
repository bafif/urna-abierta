<script lang="ts">
  import { onMount } from 'svelte';
  import Ic from '../components/Ic.svelte';
  import Pantalla from '../components/Pantalla.svelte';
  import { formatDay, t } from '../i18n.svelte.ts';
  import { nav } from '../nav.svelte.ts';
  import { session } from '../session.svelte.ts';
  import type { ElectionSummary } from '../types.ts';

  let { id }: { id: string } = $props();
  let days = $state<string[]>([]);
  let hours = $state<Record<string, { open: string; close: string }>>({});
  let same = $state(true);
  let failed = $state(false);

  onMount(async () => {
    const election = (await session.api<{ elections: ElectionSummary[] }>('/elections')).elections.find((item) => item.id === id);
    if (!election) return;
    days = election.days;
    const kept = election.hours ?? {};
    hours = Object.fromEntries(days.map((day) => [day, kept[day] ?? { open: '08:00', close: '18:00' }]));
    same = new Set(days.map((day) => `${hours[day]!.open}-${hours[day]!.close}`)).size <= 1;
  });

  /** The same hours every day, or one row per day. */
  const shown = $derived(same ? days.slice(0, 1) : days);
  const valid = $derived(shown.every((day) => hours[day] && hours[day]!.open < hours[day]!.close));

  async function save() {
    failed = false;
    const first = hours[days[0]!]!;
    const body = Object.fromEntries(days.map((day) => [day, same ? first : hours[day]!]));
    try {
      await session.api(`/elections/${id}`, { method: 'PUT', body: { hours: body } });
      nav.back();
    } catch {
      failed = true;
    }
  }
</script>

<Pantalla accion="eleccion" volver ojo={t('electionEdit.eyebrow')} titulo={t('hours.title')} bajada={t('hours.text')} desliza>
  {#if days.length > 1}
    <label class="casilla"><input type="checkbox" bind:checked={same} data-testid="hours-same" /><span>{t('hours.same')}</span></label>
  {/if}
  {#each shown as day (day)}
    {#if hours[day]}
      {#if !same}<p class="etiqueta">{formatDay(day)}</p>{/if}
      <div class="dos-campos">
        <label class="campo"><span>{t('hours.open')}</span><input type="time" bind:value={hours[day]!.open} data-testid="hours-open" /></label>
        <label class="campo"><span>{t('hours.close')}</span><input type="time" bind:value={hours[day]!.close} data-testid="hours-close" /></label>
      </div>
    {/if}
  {/each}
  {#if failed}<p class="problema" role="alert">{t('error.tryAgain')}</p>{/if}
  {#snippet pie()}
    <button class="boton primario" disabled={!valid || days.length === 0} onclick={save}><Ic name="tilde" /><span>{t('save')}</span></button>
  {/snippet}
</Pantalla>
