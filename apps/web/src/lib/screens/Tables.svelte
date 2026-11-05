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

  let { election }: { election: string } = $props();

  const DEFAULT_SIZE = 350;
  let tables = $state.raw<Table[]>([]);
  let summary = $state.raw<ElectionSummary | null>(null);
  let size = $state(DEFAULT_SIZE);
  let editing = $state<Table | null>(null);
  let name = $state('');
  let place = $state('');

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

  async function propose() {
    await session.api(`/elections/${election}/tables/propose`, { method: 'POST', body: { size } });
    await load();
  }

  function edit(table: Table) {
    editing = table;
    name = table.name;
    place = table.place;
  }

  async function save() {
    await session.api(`/tables/${editing!.id}`, { method: 'PUT', body: { name, place } });
    editing = null;
    await load();
  }
</script>

{#if editing}
  <Pantalla accion="eleccion" volver onback={() => (editing = null)} titulo={editing.name}>
    <label class="campo"><span>{t('tables.name')}</span><input bind:value={name} /></label>
    <label class="campo"><span>{t('tables.place')}</span><input bind:value={place} data-testid="table-place" /></label>
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
    {#snippet pie()}
      <button class="boton primario" onclick={() => nav.back()}><Ic name="tilde" /><span>{t('tables.ok')}</span></button>
    {/snippet}
  </Pantalla>
{/if}
