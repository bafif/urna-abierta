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
  // The day closed when its envelopes were counted, or when today is no voting day after the first one.
  const closed = $derived.by(() => {
    const all = app.table?.days ?? [];
    return app.countedDays.has(app.today) || (all.length > 0 && app.today > all[0]! && !all.includes(app.today));
  });
  let asking = $state<RollEntry | null>(null);
  /** Asked once per visit: whoever said yes may have a few more to cross out. */
  let allowed = false;

  function stay(id: string, on: boolean) {
    const next = new Set(staying);
    if (on) next.add(id);
    else next.delete(id);
    staying = next;
  }

  async function mark(entry: RollEntry) {
    if (app.noRoom || staying.has(entry.id)) return;
    if (closed && !allowed) {
      asking = entry;
      return;
    }
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

  function markAnyway() {
    allowed = true;
    const entry = asking;
    asking = null;
    if (entry) void mark(entry);
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
            <span class="nombre"><span class="nombre-t">{entry.name}</span>{#if entry.light}<span class="luz-chica" style:background={entry.light.color} title={entry.light.name} role="img" aria-label={entry.light.name}></span>{/if}</span>
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
    {#if asking}
      <div class="pila" role="alertdialog" aria-label={t('roll.closed.ask')} data-testid="closed-ask">
        <p class="aviso-fuerte">{t('roll.closed.ask')}</p>
        <button class="boton primario" onclick={markAnyway}>{t('roll.closed.yes')}</button>
        <button class="boton secundario" onclick={() => (asking = null)}>{t('roll.closed.no')}</button>
      </div>
    {:else}
      <button class="boton discreto-peligro" onclick={() => nav.go('alert')}><Ic name="aviso" /><span>{t('roll.problem')}</span></button>
    {/if}
  {/snippet}
</Pantalla>
