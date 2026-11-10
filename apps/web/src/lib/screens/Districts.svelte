<script lang="ts">
  import { onMount } from 'svelte';
  import Ic from '../components/Ic.svelte';
  import Options from '../components/Options.svelte';
  import Pantalla from '../components/Pantalla.svelte';
  import { roleName, t, type MessageKey } from '../i18n.svelte.ts';
  import { nav } from '../nav.svelte.ts';
  import { ApiError, session } from '../session.svelte.ts';

  interface Unit {
    id: string;
    name: string;
    chief: string | null;
    chief_id: string | null;
    tables: number;
  }
  interface Table {
    id: string;
    name: string;
    unit_id: string | null;
  }
  /** Someone in the team, with what they already do. */
  interface Member {
    id: string;
    name: string;
    roles: { role: string }[];
  }

  let { election }: { election: string } = $props();
  let units = $state.raw<Unit[]>([]);
  let tables = $state.raw<Table[]>([]);
  let status = $state<string | null>(null);
  let open = $state<string | null>(null);
  let name = $state('');
  /** The open district's name, being corrected. */
  let rename = $state('');
  let choosingChief = $state(false);
  let team = $state.raw<Member[]>([]);
  let chief = $state<string | null>(null);
  let failed = $state<MessageKey | ''>('');

  const current = $derived(units.find((unit) => unit.id === open) ?? null);
  const unitName = (id: string | null) => units.find((unit) => unit.id === id)?.name ?? '';

  const load = async () => {
    const [listed, all] = await Promise.all([
      session.api<{ units: Unit[]; status?: string | null }>(`/elections/${election}/units`),
      session.api<{ tables: Table[] }>(`/elections/${election}/tables`),
    ]);
    units = listed.units;
    status = listed.status ?? null;
    tables = all.tables;
  };
  onMount(load);

  /** What went wrong, said once: a district goes only while the election is prepared, and anything else is the signal. */
  async function attempt(work: () => Promise<unknown>) {
    failed = '';
    try {
      await work();
      await load();
    } catch (error) {
      failed = error instanceof ApiError && error.code === 'only_while_preparing' ? 'districts.onlyPreparing' : 'error.tryAgain';
    }
  }

  function toggle(unit: Unit) {
    open = open === unit.id ? null : unit.id;
    rename = unit.name;
    failed = '';
  }

  async function add() {
    await attempt(async () => {
      const { id } = await session.api<{ id: string }>(`/elections/${election}/units`, { method: 'POST', body: { name } });
      open = id;
      rename = name;
      name = '';
    });
  }

  const saveName = () => attempt(() => session.api(`/units/${open}`, { method: 'PUT', body: { name: rename } }));

  /** A table of this district leaves it when touched; any other comes to it, from wherever it was. */
  const moveTable = (table: Table) => attempt(() => session.api(`/tables/${table.id}`, { method: 'PUT', body: { unit: table.unit_id === open ? null : open } }));

  async function pickChief() {
    team = await session.api<{ users: Member[] }>('/users').then((answer) => answer.users).catch(() => []);
    chief = null;
    failed = '';
    choosingChief = true;
  }

  const candidates = $derived(
    team
      .filter((member) => member.id !== current?.chief_id)
      .map((member) => {
        const tasks = [...new Set(member.roles.map((task) => roleName(task.role)))].join(', ');
        return { id: member.id, title: member.name, detail: tasks ? `${tasks}. ${t('districts.pick.adds')}` : t('districts.pick.adds') };
      }),
  );
  const candidate = $derived(candidates.find((item) => item.id === chief) ?? null);

  async function setChief() {
    await attempt(() => session.api(`/units/${open}`, { method: 'PUT', body: { chief } }));
    if (!failed) choosingChief = false;
  }

  async function remove() {
    if (!current || !confirm(t('districts.deleteConfirm', { name: current.name }))) return;
    await attempt(() => session.api(`/units/${current!.id}`, { method: 'DELETE' }));
    if (!failed) open = null;
  }
</script>

{#if choosingChief && current}
  <Pantalla accion="equipo" volver onback={() => (choosingChief = false)} ojo={current.name} titulo={t('districts.who', { name: current.name })} desliza>
    {#if candidates.length > 0}
      <p class="etiqueta">{t('fiscales.pick.team')}</p>
      <Options items={candidates} bind:value={chief} />
    {:else}
      <p class="aviso-suave">{t('fiscales.pick.nobody')}</p>
    {/if}
    {#if failed}<p class="problema" role="alert">{t(failed as MessageKey)}</p>{/if}
    {#snippet pie()}
      <div class="pila">
        {#if candidate}
          <button class="boton primario" onclick={setChief} data-testid="set-chief"><Ic name="tilde" /><span>{t('fiscales.pick.assign', { name: candidate.title.split(' ')[0] ?? candidate.title })}</span></button>
        {/if}
        <button class={candidate ? 'enlace' : 'boton secundario'} onclick={() => nav.go('addPerson', { role: 'jefe', unit: current!.id, label: t('districts.who', { name: current!.name }) })}>{t('pick.new')}</button>
      </div>
    {/snippet}
  </Pantalla>
{:else}
  <Pantalla accion="equipo" volver titulo={t('districts.title')} bajada={t('districts.text')} desliza>
    <div class="tarjetas">
      {#each units as unit (unit.id)}
        <button class="tarjeta" data-testid="unit" onclick={() => toggle(unit)}>
          <strong>{unit.name}</strong>
          <span>{t('districts.summary', { count: unit.tables })} · {unit.chief ?? t('districts.noChief')}</span>
        </button>
        {#if open === unit.id}
          <label class="campo"><span>{t('districts.name')}</span><input bind:value={rename} data-testid="unit-rename" /></label>
          {#if rename.trim() && rename.trim() !== unit.name}
            <button class="boton secundario chico" onclick={saveName}><Ic name="tilde" /><span>{t('districts.rename')}</span></button>
          {/if}
          {#if unit.chief}
            <p class="aclara">{t('districts.chief', { name: unit.chief })}</p>
            <button class="enlace" onclick={pickChief} data-testid="change-chief">{t('districts.changeChief')}</button>
          {:else}
            <button class="enlace" onclick={pickChief}>{t('districts.addChief')}</button>
          {/if}
          <p class="etiqueta">{t('districts.tables')}</p>
          <p class="aclara">{t('districts.tables.hint')}</p>
          <div class="opciones">
            {#each tables as table (table.id)}
              <button class="opcion" class:elegida={table.unit_id === unit.id} aria-pressed={table.unit_id === unit.id} data-testid="unit-table" onclick={() => moveTable(table)}>
                <span class="radio"></span>
                <span><strong>{table.name}</strong>{#if table.unit_id && table.unit_id !== unit.id}<small>{t('districts.inOther', { unit: unitName(table.unit_id) })}</small>{/if}</span>
              </button>
            {/each}
          </div>
          {#if status === 'preparacion'}
            <button class="enlace peligro" onclick={remove} data-testid="unit-delete">{t('districts.delete')}</button>
          {/if}
          {#if failed}<p class="problema" role="alert">{t(failed as MessageKey)}</p>{/if}
        {/if}
      {/each}
    </div>
    <label class="campo"><span>{t('districts.new')}</span><input bind:value={name} data-testid="unit-name" /></label>
    <button class="boton secundario" disabled={!name.trim()} onclick={add}><Ic name="mas" /><span>{t('districts.add')}</span></button>
  </Pantalla>
{/if}
