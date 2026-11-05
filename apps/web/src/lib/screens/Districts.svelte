<script lang="ts">
  import { onMount } from 'svelte';
  import Ic from '../components/Ic.svelte';
  import Pantalla from '../components/Pantalla.svelte';
  import { t } from '../i18n.svelte.ts';
  import { nav } from '../nav.svelte.ts';
  import { session } from '../session.svelte.ts';

  interface Unit {
    id: string;
    name: string;
    chief: string | null;
    tables: number;
  }
  interface Table {
    id: string;
    name: string;
    unit_id: string | null;
  }

  let { election }: { election: string } = $props();
  let units = $state.raw<Unit[]>([]);
  let tables = $state.raw<Table[]>([]);
  let open = $state<string | null>(null);
  let name = $state('');

  const load = async () => {
    const [listed, all] = await Promise.all([
      session.api<{ units: Unit[] }>(`/elections/${election}/units`),
      session.api<{ tables: Table[] }>(`/elections/${election}/tables`),
    ]);
    units = listed.units;
    tables = all.tables;
  };
  onMount(load);

  async function add() {
    const { id } = await session.api<{ id: string }>(`/elections/${election}/units`, { method: 'POST', body: { name } });
    name = '';
    await load();
    open = id;
  }

  async function assign(table: Table, unit: string) {
    await session.api(`/tables/${table.id}`, { method: 'PUT', body: { unit } });
    await load();
  }
</script>

<Pantalla accion="equipo" volver titulo={t('districts.title')} bajada={t('districts.text')} desliza>
  <div class="tarjetas">
    {#each units as unit (unit.id)}
      <button class="tarjeta" data-testid="unit" onclick={() => (open = open === unit.id ? null : unit.id)}>
        <strong>{unit.name}</strong>
        <span>{t('districts.summary', { count: unit.tables })} · {unit.chief ?? t('districts.noChief')}</span>
      </button>
      {#if open === unit.id}
        {#if !unit.chief}
          <button class="enlace" onclick={() => nav.go('addPerson', { role: 'jefe', unit: unit.id, label: t('districts.who', { name: unit.name }) })}>{t('districts.addChief')}</button>
        {/if}
        <div class="opciones">
          {#each tables as table (table.id)}
            <button class="opcion" class:elegida={table.unit_id === unit.id} aria-pressed={table.unit_id === unit.id} data-testid="unit-table" onclick={() => assign(table, unit.id)}>
              <span class="radio"></span><span><strong>{table.name}</strong></span>
            </button>
          {/each}
        </div>
      {/if}
    {/each}
  </div>
  <label class="campo"><span>{t('districts.new')}</span><input bind:value={name} data-testid="unit-name" /></label>
  <button class="boton secundario" disabled={!name.trim()} onclick={add}><Ic name="mas" /><span>{t('districts.add')}</span></button>
</Pantalla>
