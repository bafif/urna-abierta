<script lang="ts">
  import { onMount } from 'svelte';
  import Ic from '../components/Ic.svelte';
  import Pantalla from '../components/Pantalla.svelte';
  import { formatDayShort, i18n, t } from '../i18n.svelte.ts';
  import { session } from '../session.svelte.ts';

  interface Category {
    id: string;
    name: string;
    lists: { id: string; name: string }[];
  }
  interface Item {
    id: string;
    table: { id: string; name: string };
    type: 'tally.submitted' | 'tally.photo' | 'envelopes.counted';
    payload: { category?: string; results?: Record<string, number>; day?: string; envelopes?: number; marked?: number };
    at: string;
    author: string | null;
    envelopes: number | null;
    earlier: boolean;
    clash: boolean;
  }

  let { election }: { election: string } = $props();
  let items = $state.raw<Item[]>([]);
  let categories = $state.raw<Category[]>([]);
  let closedAt = $state<string | null>(null);
  let loaded = $state(false);
  let open = $state<Item | null>(null);
  let busy = $state(false);
  let problem = $state(false);

  async function load() {
    try {
      const answer = await session.api<{ items: Item[]; categories: Category[]; closedAt: string | null }>(`/elections/${election}/late`);
      ({ items, categories, closedAt } = answer);
      problem = false;
    } catch {
      problem = true;
    }
    loaded = true;
  }
  onMount(load);

  /** Always a person's decision, and the server logs it. */
  async function decide(decision: 'sumado' | 'descartado') {
    if (!open) return;
    busy = true;
    try {
      await session.api(`/late/${open.id}`, { method: 'POST', body: { decision } });
      open = null;
      await load();
    } catch {
      problem = true;
    }
    busy = false;
  }

  const categoryOf = (item: Item) => categories.find((category) => category.id === item.payload.category);
  const what = (item: Item) =>
    item.type === 'tally.submitted' ? t('late.title.tally', { category: categoryOf(item)?.name ?? '' }) : item.type === 'tally.photo' ? t('late.title.photo') : t('late.title.envelopes', { day: formatDayShort(item.payload.day ?? '') });
  /** «Jueves 8, 23:40». */
  function moment(iso: string): string {
    const date = new Date(iso);
    const day = formatDayShort(date.toLocaleDateString('sv'));
    return `${day.charAt(0).toUpperCase()}${day.slice(1)}, ${date.toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' })}`;
  }
  /** How long after the close: «1 h 40 min». */
  function after(iso: string): string {
    const minutes = Math.max(0, Math.round((Date.parse(iso) - Date.parse(closedAt ?? '')) / 60_000));
    const hours = Math.floor(minutes / 60);
    return hours === 0 ? `${minutes} min` : minutes % 60 === 0 ? `${hours} h` : `${hours} h ${minutes % 60} min`;
  }
  const total = (item: Item) => Object.values(item.payload.results ?? {}).reduce((sum, count) => sum + count, 0);
</script>

{#if open}
  {@const item = open}
  <Pantalla volver onback={() => (open = null)} ojo={t('late.eyebrow', { table: item.table.name })} titulo={what(item)}
    bajada={item.author ? t('late.sent', { name: item.author, when: moment(item.at) }) : t('late.sent.noName', { when: moment(item.at) })}>
    {#if item.type === 'tally.submitted'}
      <div class="tarjeta">
        <dl class="tabla-datos">
          {#each categoryOf(item)?.lists ?? [] as list (list.id)}
            <dt>{list.name}</dt><dd>{item.payload.results?.[list.id] ?? 0}</dd>
          {/each}
          <dt class="total">{t('late.total')}</dt><dd class="total">{total(item)}</dd>
        </dl>
      </div>
      {#if item.envelopes !== null}
        {#if total(item) === item.envelopes}
          <p class="resultado bien"><Ic name="tilde" />{t('late.match', { count: item.envelopes })}</p>
        {:else}
          <p class="aclara">{t('late.differ', { count: item.envelopes })}</p>
        {/if}
      {/if}
      <p class="aclara">{item.clash ? t('late.clash') : item.earlier ? t('late.same') : t('late.alone')}</p>
    {:else}
      {#if item.type === 'envelopes.counted'}<p>{t('late.envelopes.detail', { envelopes: item.payload.envelopes ?? 0, marked: item.payload.marked ?? 0 })}</p>{/if}
      <p class="aclara">{t('late.logged')}</p>
    {/if}
    {#if problem}<p class="problema" role="alert">{t('error.tryAgain')}</p>{/if}
    {#snippet pie()}
      <div class="pila">
        <button class="boton primario" data-testid="late-add" disabled={busy} onclick={() => decide('sumado')}><Ic name="tilde" /><span>{t('late.add')}</span></button>
        <button class="enlace" data-testid="late-discard" disabled={busy} onclick={() => decide('descartado')}>{t('late.discard')}</button>
      </div>
    {/snippet}
  </Pantalla>
{:else}
  <Pantalla volver titulo={!loaded ? '' : items.length === 0 ? t('late.none') : t('late.link', { count: items.length })} bajada={items.length > 0 ? t('late.text') : undefined}>
    {#if problem}<p class="problema" role="alert">{t('error.tryAgain')}</p>{/if}
    <div class="tarjetas">
      {#each items as item (item.id)}
        <button class="tarjeta" data-testid="late-item" onclick={() => (open = item)}>
          <strong>{t('late.item', { table: item.table.name, what: what(item) })}</strong>
          <span>{closedAt ? t('late.when', { when: moment(item.at), after: after(item.at) }) : moment(item.at)}</span>
        </button>
      {/each}
    </div>
  </Pantalla>
{/if}
