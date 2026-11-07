<script lang="ts">
  import { onMount } from 'svelte';
  import Ic from '../components/Ic.svelte';
  import Pantalla from '../components/Pantalla.svelte';
  import { t } from '../i18n.svelte.ts';
  import { nav } from '../nav.svelte.ts';
  import { session } from '../session.svelte.ts';
  import type { ElectionSummary } from '../types.ts';

  interface Table {
    id: string;
    name: string;
    place: string;
    people: number;
    from: string;
    to: string;
  }
  interface Person {
    id: string;
    name: string;
    order: number | null;
  }

  let { election }: { election: string } = $props();

  const DEFAULT_SIZE = 350;
  let tables = $state.raw<Table[]>([]);
  let summary = $state.raw<ElectionSummary | null>(null);
  let size = $state(DEFAULT_SIZE);
  let editing = $state<Table | null>(null);
  let name = $state('');
  let place = $state('');
  /** The last surname of the table, against the next one. */
  let last = $state('');
  let preview = $state<{ here: number; next: number } | null>(null);
  let people = $state.raw<Person[] | null>(null);
  let filter = $state('');
  let moving = $state<Person | null>(null);
  let failed = $state(false);
  let previewTimer: ReturnType<typeof setTimeout> | undefined;

  const load = async () => {
    const [listed, all] = await Promise.all([
      session.api<{ tables: Table[] }>(`/elections/${election}/tables`),
      session.api<{ elections: ElectionSummary[] }>('/elections'),
    ]);
    tables = listed.tables;
    summary = all.elections.find((item) => item.id === election) ?? null;
  };
  onMount(load);

  const without = $derived(summary?.without_table ?? 0);
  const proposal = $derived(Math.ceil(without / Math.max(size, 1)));
  const preparing = $derived(summary?.status === 'preparacion');
  const next = $derived(editing ? tables[tables.findIndex((table) => table.id === editing!.id) + 1] : undefined);
  const shown = $derived((people ?? []).filter((person) => !filter.trim() || person.name.toLowerCase().includes(filter.trim().toLowerCase())));

  async function propose() {
    await session.api(`/elections/${election}/tables/propose`, { method: 'POST', body: { size } });
    await load();
  }

  async function startOver() {
    if (!confirm(t('tables.reset.confirm'))) return;
    await session.api(`/elections/${election}/tables/reset`, { method: 'POST' });
    await load();
  }

  function edit(table: Table) {
    editing = table;
    name = table.name;
    place = table.place;
    last = '';
    preview = null;
    people = null;
    failed = false;
  }

  /** How many would stay in each table, said before saving. */
  function lookAhead() {
    clearTimeout(previewTimer);
    preview = null;
    if (!last.trim() || !editing) return;
    previewTimer = setTimeout(async () => {
      preview = await session.api<{ here: number; next: number }>(`/tables/${editing!.id}/cut?preview=1`, { method: 'POST', body: { last } }).catch(() => null);
    }, 300);
  }

  async function save() {
    failed = false;
    try {
      await session.api(`/tables/${editing!.id}`, { method: 'PUT', body: { name, place } });
      if (preparing && next && last.trim()) await session.api(`/tables/${editing!.id}/cut`, { method: 'POST', body: { last } });
      editing = null;
      await load();
    } catch {
      failed = true;
    }
  }

  async function showPeople() {
    people = (await session.api<{ people: Person[] }>(`/tables/${editing!.id}/people`)).people;
    filter = '';
  }

  async function moveTo(table: Table) {
    failed = false;
    try {
      await session.api(`/tables/${editing!.id}/people/${encodeURIComponent(moving!.id)}`, { method: 'PUT', body: { to: table.id } });
      moving = null;
      await showPeople();
      await load();
    } catch {
      failed = true;
    }
  }

  async function remove() {
    if (!confirm(t('tables.delete.confirm', { table: editing!.name }))) return;
    await session.api(`/tables/${editing!.id}`, { method: 'DELETE' });
    editing = null;
    await load();
  }
</script>

{#if editing && moving}
  <Pantalla accion="eleccion" volver onback={() => (moving = null)} ojo={moving.name} titulo={t('tables.moveTo')} desliza>
    <div class="items">
      {#each tables.filter((table) => table.id !== editing!.id) as table (table.id)}
        <button class="item" data-testid="move-to" onclick={() => moveTo(table)}><span class="item-texto"><strong>{table.name}</strong><small>{t('tables.people', { count: table.people })}</small></span></button>
      {/each}
    </div>
    {#if failed}<p class="problema" role="alert">{t('error.tryAgain')}</p>{/if}
  </Pantalla>
{:else if editing && people}
  <Pantalla accion="eleccion" volver onback={() => (people = null)} ojo={editing.name} titulo={t('tables.people', { count: people.length })} desliza>
    <label class="campo"><span>{t('tables.search')}</span><input bind:value={filter} data-testid="people-filter" /></label>
    <div class="items">
      {#each shown.slice(0, 200) as person (person.id)}
        <div class="item"><span class="item-texto"><strong>{person.name}</strong>{#if person.order}<small>{t('tables.order', { order: person.order })}</small>{/if}</span>
          {#if preparing}<button class="enlace" data-testid="move-person" onclick={() => (moving = person)}>{t('tables.move')}</button>{/if}
        </div>
      {/each}
    </div>
  </Pantalla>
{:else if editing}
  <Pantalla accion="eleccion" volver onback={() => (editing = null)} ojo={editing.place ? `${editing.name} · ${editing.place}` : editing.name} titulo={editing.name} desliza>
    <div class="dos-campos">
      <label class="campo"><span>{t('tables.name')}</span><input bind:value={name} /></label>
      <label class="campo"><span>{t('tables.place')}</span><input bind:value={place} data-testid="table-place" /></label>
    </div>
    {#if preparing && next}
      <p class="etiqueta">{t('tables.cut.title', { table: editing.name })}</p>
      <p class="aclara">{t('tables.cut.text', { next: next.name })}</p>
      <label class="campo"><span>{t('tables.cut.last', { table: editing.name })}</span><input bind:value={last} oninput={lookAhead} placeholder={editing.to} data-testid="table-cut" /></label>
      {#if preview}
        <p class="resultado bien" data-testid="cut-preview"><Ic name="tilde" />{t('tables.cut.preview', { here: preview.here, table: editing.name, next: preview.next, nextName: next.name })}</p>
      {/if}
    {/if}
    <div class="renglon-botones">
      <button class="enlace" data-testid="see-people" onclick={showPeople}>{t('tables.seePeople')}</button>
    </div>
    {#if preparing}
      <div class="zona-peligro">
        <button class="boton discreto-peligro chico" disabled={editing.people > 0} onclick={remove}>{t('tables.delete')}</button>
        <p class="aclara">{t('tables.delete.note')}</p>
      </div>
    {/if}
    {#if failed}<p class="problema" role="alert">{t('error.tryAgain')}</p>{/if}
    {#snippet pie()}
      <button class="boton primario" disabled={!name.trim()} onclick={save}><Ic name="tilde" /><span>{t('save')}</span></button>
    {/snippet}
  </Pantalla>
{:else if without > 0}
  <Pantalla accion="eleccion" volver ojo={t('tables.eyebrow')} titulo={t('tables.proposal', { count: proposal })} bajada={t('tables.proposal.text', { size })} desliza>
    <label class="campo"><span>{t('tables.size')}</span><input type="number" min="10" max="2000" bind:value={size} data-testid="table-size" /></label>
    {#snippet pie()}
      <button class="boton primario" disabled={!size || size < 10} onclick={propose}><Ic name="tilde" /><span>{t('tables.accept')}</span></button>
    {/snippet}
  </Pantalla>
{:else}
  <Pantalla accion="eleccion" volver ojo={t('tables.eyebrow')} titulo={t('tables.title', { count: tables.length })} bajada={t('tables.text')} desliza>
    <div class="tarjetas compactas">
      {#each tables as table (table.id)}
        <button class="tarjeta fila-mesa" data-testid="table" onclick={() => edit(table)}>
          <strong>{table.name}</strong>
          <span>{table.from && table.to ? `${table.from} – ${table.to} · ` : ''}{t('tables.people', { count: table.people })}</span>
        </button>
      {/each}
    </div>
    {#if preparing && tables.length > 0}
      <button class="enlace" data-testid="tables-reset" onclick={startOver}>{t('tables.reset')}</button>
      <p class="aclara">{t('tables.reset.note')}</p>
    {/if}
    {#snippet pie()}
      <button class="boton primario" onclick={() => nav.back()}><Ic name="tilde" /><span>{t('tables.ok')}</span></button>
    {/snippet}
  </Pantalla>
{/if}
