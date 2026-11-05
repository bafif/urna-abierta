<script lang="ts">
  import { foldText, type RollEntry } from '@urna-abierta/domain';
  import Ic from '../components/Ic.svelte';
  import Pantalla from '../components/Pantalla.svelte';
  import SyncLine from '../components/SyncLine.svelte';
  import VirtualList from '../components/VirtualList.svelte';
  import { app, shownDocument } from '../app.svelte.ts';
  import { t } from '../i18n.svelte.ts';
  import { nav } from '../nav.svelte.ts';

  const ROW_HEIGHT = 62;
  /** How long a crossed-out name stays in its place, so that the person sees what they did. */
  const STAYS_MS = 1_000;
  const UNDO_MS = 8_000;

  let query = $state('');
  let staying = $state.raw<ReadonlySet<string>>(new Set());
  let last = $state<RollEntry | null>(null);
  let undoTimer: ReturnType<typeof setTimeout> | undefined;

  const list = $derived.by(() => {
    void app.revision;
    const folded = foldText(query.trim());
    return app.electors.filter((entry) => (staying.has(entry.id) || !app.voted(entry.id)) && (folded === '' || entry.search.includes(folded)));
  });
  const total = $derived(app.electors.length);
  const marked = $derived(app.markedCount);
  const days = $derived(app.table?.days.length ?? 1);

  function stay(id: string, on: boolean) {
    const next = new Set(staying);
    if (on) next.add(id);
    else next.delete(id);
    staying = next;
  }

  async function mark(entry: RollEntry) {
    if (app.noRoom || staying.has(entry.id)) return;
    last = entry;
    clearTimeout(undoTimer);
    undoTimer = setTimeout(() => (last = null), UNDO_MS);
    stay(entry.id, true);
    setTimeout(() => stay(entry.id, false), STAYS_MS);
    query = '';
    if (!(await app.mark(entry.id))) {
      last = null;
      stay(entry.id, false);
    }
  }

  function undo() {
    if (last) {
      stay(last.id, false);
      void app.undo(last.id);
    }
    last = null;
  }
</script>

<Pantalla accion="tachar" volver ojo={days > 1 ? t('roll.eyebrowDays', { table: app.table?.name ?? '', day: app.dayNumber, days }) : (app.table?.name ?? '')}>
  {#snippet encabezado()}
    <span data-testid="remaining">
      <span class="faltan">{total - marked}</span>
      <span class="de">{t('roll.left', { total })}</span>
    </span>
    {#if marked > 0}
      <button class="enlace en-titulo" onclick={() => nav.go('voted')}>{t('roll.seeVoted', { count: marked })}</button>
    {/if}
  {/snippet}
  <SyncLine />
  <label class="buscar">
    <Ic name="lupa" />
    <input type="search" bind:value={query} placeholder={t('roll.search')} aria-label={t('roll.search')} autocomplete="off" />
  </label>
  {#if list.length === 0}
    <p class="centrado">{t('roll.empty')}</p>
  {:else}
    <div class="lista">
      <VirtualList items={list} rowHeight={ROW_HEIGHT}>
        {#snippet row(entry: RollEntry)}
          {@const done = staying.has(entry.id)}
          <button class="fila" class:tachada={done} data-testid={done ? 'person-done' : 'person'} disabled={app.noRoom || done} onclick={() => mark(entry)}>
            <span class="num">{entry.order}</span>
            <span class="nombre"><span class="nombre-t">{entry.name}</span></span>
            <span class="doc">{shownDocument(entry.documentSuffix)}</span>
          </button>
        {/snippet}
      </VirtualList>
    </div>
  {/if}
  {#if last}
    <div class="deshacer" role="status">
      <span>{t('roll.marked', { name: last.name })}</span>
      <button onclick={undo}>{t('roll.undo')}</button>
    </div>
  {/if}
  {#snippet pie()}
    <button class="boton discreto-peligro" onclick={() => nav.go('alert')}><Ic name="aviso" /><span>{t('roll.problem')}</span></button>
  {/snippet}
</Pantalla>
