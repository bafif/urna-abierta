<script lang="ts">
  import { onMount } from 'svelte';
  import Ic from '../components/Ic.svelte';
  import Pantalla from '../components/Pantalla.svelte';
  import { formatDay, formatRange, t } from '../i18n.svelte.ts';
  import { nav } from '../nav.svelte.ts';
  import { session } from '../session.svelte.ts';
  import type { ElectionSummary } from '../types.ts';

  let { id }: { id: string } = $props();
  let election = $state.raw<ElectionSummary | null>(null);
  let deleting = $state(false);
  let typed = $state('');
  let failed = $state(false);

  onMount(async () => {
    election = (await session.api<{ elections: ElectionSummary[] }>('/elections')).elections.find((item) => item.id === id) ?? null;
  });

  const preparing = $derived(election?.status === 'preparacion');
  const daysOpen = $derived(Boolean(election) && !['cerrada', 'purgada'].includes(election!.status));
  /** «De 08:00 a 18:00», or that the hours change by day, or that nobody said them yet. */
  const hoursText = $derived.by(() => {
    const set = Object.values(election?.hours ?? {});
    if (set.length === 0) return t('hours.none');
    const distinct = new Set(set.map((times) => `${times.open}-${times.close}`));
    return distinct.size === 1 ? t('hours.range', { open: set[0]!.open, close: set[0]!.close }) : t('hours.byDay');
  });
  const lists = $derived((election?.categories ?? []).reduce((sum, category) => sum + category.lists.filter((list) => !['blanco', 'nulo', 'recurrido'].includes(list.id)).length, 0));

  async function remove() {
    failed = false;
    try {
      await session.api(`/elections/${id}`, { method: 'DELETE', body: { name: typed } });
      nav.home();
    } catch {
      failed = true;
    }
  }
</script>

{#if election && deleting}
  <Pantalla accion="eleccion" volver onback={() => (deleting = false)} ojo={t('electionEdit.eyebrow')} titulo={t('electionEdit.delete.title', { name: election.name })} bajada={t('electionEdit.delete.text')}>
    <label class="campo"><span>{t('election.name')}</span><input bind:value={typed} data-testid="delete-name" autocomplete="off" /></label>
    {#if failed}<p class="problema" role="alert">{t('error.tryAgain')}</p>{/if}
    {#snippet pie()}
      <button class="boton peligro" data-testid="delete-forever" disabled={typed !== election!.name} onclick={remove}>{t('electionEdit.delete.go')}</button>
    {/snippet}
  </Pantalla>
{:else if election}
  <Pantalla accion="eleccion" volver ojo={t('electionEdit.eyebrow')} titulo={t('electionEdit.title')} desliza>
    <div class="tarjetas">
      <button class="tarjeta fila-cambio" onclick={() => nav.go('electionNew', { edit: id, part: 'name' })}>
        <span class="item-texto"><strong>{t('election.name')}</strong><span>{election.name}</span></span><span class="ver">{t('electionEdit.change')}</span>
      </button>
      <button class="tarjeta fila-cambio" disabled={!daysOpen} onclick={() => nav.go('electionNew', { edit: id, part: 'days' })}>
        <span class="item-texto"><strong>{t('electionEdit.days')}</strong><span>{formatRange(election.days)}. {daysOpen ? t('electionEdit.days.until') : t('electionEdit.closed')}</span></span>
        {#if daysOpen}<span class="ver">{t('electionEdit.change')}</span>{/if}
      </button>
      <button class="tarjeta fila-cambio" disabled={!daysOpen} data-testid="edit-hours" onclick={() => nav.go('electionHours', { id })}>
        <span class="item-texto"><strong>{t('hours.title')}</strong><span>{hoursText}</span></span>
        {#if daysOpen}<span class="ver">{t('electionEdit.change')}</span>{/if}
      </button>
      <button class="tarjeta fila-cambio" disabled={election.status === 'purgada'} data-testid="edit-keep" onclick={() => nav.go('electionNew', { edit: id, part: 'keep' })}>
        <span class="item-texto"><strong>{t('keep.title.short')}</strong><span>{election.purge_by ? t('keep.when', { date: formatDay(election.purge_by) }) : t('keep.none')}</span></span>
        <span class="ver">{t('electionEdit.change')}</span>
      </button>
      <button class="tarjeta fila-cambio" disabled={!preparing} data-testid="edit-lists" onclick={() => nav.go('electionNew', { edit: id, part: 'lists' })}>
        <span class="item-texto"><strong>{t('electionEdit.lists')}</strong><span>{t('electionEdit.lists.count', { categories: election.categories.length, lists })} {preparing ? t('electionEdit.lists.until') : t('electionEdit.lists.locked')}</span></span>
        {#if preparing}<span class="ver">{t('electionEdit.change')}</span>{/if}
      </button>
    </div>
    {#if preparing}
      <div class="zona-peligro">
        <button class="boton discreto-peligro" data-testid="delete-election" onclick={() => (deleting = true)}>{t('electionEdit.delete')}</button>
        <p class="aclara">{t('electionEdit.delete.note')}</p>
      </div>
    {/if}
    {#snippet pie()}
      <button class="boton primario" onclick={() => nav.back()}><Ic name="tilde" /><span>{t('electionEdit.done')}</span></button>
    {/snippet}
  </Pantalla>
{:else}
  <Pantalla volver />
{/if}
