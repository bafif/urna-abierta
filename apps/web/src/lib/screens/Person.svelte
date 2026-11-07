<script lang="ts">
  import { onMount } from 'svelte';
  import Ic from '../components/Ic.svelte';
  import Options from '../components/Options.svelte';
  import Pantalla from '../components/Pantalla.svelte';
  import { formatDayChoice, i18n, roleName, t } from '../i18n.svelte.ts';
  import { nav } from '../nav.svelte.ts';
  import { session } from '../session.svelte.ts';
  import type { ElectionSummary } from '../types.ts';

  interface Task {
    id: string;
    role: string;
    table: string | null;
    tableName: string | null;
    unit: string | null;
    unitName: string | null;
    election: string | null;
    days: string[] | null;
  }
  interface Person {
    id: string;
    name: string;
    phone: string | null;
    joined: boolean;
    joined_at: string | null;
    roles: Task[];
  }
  interface Place {
    id: string;
    name: string;
    fiscales?: { id: string; name: string }[];
  }
  /** Choosing a table or a district: for one of their tasks, or for a new one. */
  interface Picking {
    task?: Task;
    role: string;
    election: string;
    places: Place[];
  }

  /** Tasks with a place: a table for a poll watcher, a district for a chief. */
  const PLACED = ['fiscal', 'jefe'];
  const SIMPLE = ['fiscal', 'jefe', 'semaforo', 'estadistico'];

  let { id }: { id: string } = $props();
  let person = $state.raw<Person | null>(null);
  let name = $state('');
  let phone = $state('');
  let adding = $state(false);
  let newRole = $state<string | null>(null);
  let picking = $state.raw<Picking | null>(null);
  let failed = $state(false);

  async function load() {
    person = (await session.api<{ users: Person[] }>('/users')).users.find((item) => item.id === id) ?? null;
    if (person) {
      name = person.name;
      phone = person.phone ?? '';
    }
  }
  onMount(load);

  /** What they do, as the proposal says it: «Cuidar la Mesa 12», with the role and the days below. */
  const taskTitle = (task: Task) =>
    task.role === 'fiscal' && task.tableName ? t('person.task.table', { table: task.tableName }) : task.role === 'jefe' && task.unitName ? t('person.task.unit', { unit: task.unitName }) : roleName(task.role);
  const taskDetail = (task: Task) => [roleName(task.role), task.days?.length ? formatDayChoice(task.days) : PLACED.includes(task.role) ? t('person.task.allDays') : ''].filter(Boolean).join(' · ');

  /** The election a new task goes to: the one under way, or else the newest that is not closed. */
  async function currentElection(): Promise<string | null> {
    const { elections } = await session.api<{ elections: ElectionSummary[] }>('/elections');
    const open = elections.filter((election) => !['cerrada', 'purgada'].includes(election.status));
    return (open.find((election) => election.status === 'jornada') ?? open[0])?.id ?? null;
  }

  async function choosePlace(role: string, task?: Task) {
    failed = false;
    const election = task?.election ?? (await currentElection());
    if (!election) {
      failed = true;
      return;
    }
    const places = role === 'fiscal'
      ? (await session.api<{ tables: Place[] }>(`/elections/${election}/tables`)).tables
      : (await session.api<{ units: Place[] }>(`/elections/${election}/units`)).units;
    picking = { task, role, election, places };
  }

  async function placeChosen(place: Place) {
    if (!picking) return;
    const others = (place.fiscales ?? []).filter((fiscal) => fiscal.id !== id);
    // Two poll watchers at one table is possible, and not the usual: it asks.
    if (picking.role === 'fiscal' && others.length > 0 && !confirm(t('person.another', { table: place.name, name: others[0]!.name }))) return;
    const where = picking.role === 'fiscal' ? { table: place.id } : { unit: place.id };
    try {
      if (picking.task) await session.api(`/users/${id}/roles/${picking.task.id}`, { method: 'PUT', body: where });
      else await session.api(`/users/${id}/roles`, { method: 'POST', body: { role: picking.role, ...where } });
      picking = null;
      adding = false;
      newRole = null;
      await load();
    } catch {
      failed = true;
    }
  }

  async function addTask() {
    if (!newRole) return;
    if (PLACED.includes(newRole)) return choosePlace(newRole);
    try {
      await session.api(`/users/${id}/roles`, { method: 'POST', body: { role: newRole } });
      adding = false;
      newRole = null;
      await load();
    } catch {
      failed = true;
    }
  }

  async function removeTask(task: Task) {
    if (!confirm(t('person.removeTask', { task: taskTitle(task) }))) return;
    await session.api(`/users/${id}/roles/${task.id}`, { method: 'DELETE' });
    await load();
  }

  async function invite() {
    const { invitation } = await session.api<{ invitation: string }>(`/users/${id}/invitation`, { method: 'POST' });
    nav.go('invite', { name: person!.name, phone: person!.phone, token: invitation });
  }

  async function lostPhone() {
    if (!confirm(t('person.lost.confirm', { name: person!.name }))) return;
    const { invitation } = await session.api<{ invitation?: string }>(`/users/${id}/lost-phone`, { method: 'POST' });
    if (invitation) nav.go('invite', { name: person!.name, phone: person!.phone, token: invitation });
    else await load();
  }

  async function removePerson() {
    if (!confirm(t('team.removeConfirm', { name: person!.name }))) return;
    await session.api(`/users/${id}`, { method: 'DELETE' });
    nav.back();
  }

  async function save() {
    failed = false;
    try {
      await session.api(`/users/${id}`, { method: 'PUT', body: { name: name.trim(), phone: phone.trim() || null } });
      nav.back();
    } catch {
      failed = true;
    }
  }

  const roles = $derived(SIMPLE.map((role) => ({ id: role, title: t(`role.${role}.title` as Parameters<typeof t>[0]), detail: t(`role.${role}.detail` as Parameters<typeof t>[0]) })));
  const joinedOn = $derived(person?.joined_at ? new Date(person.joined_at).toLocaleDateString(i18n.language, { day: 'numeric', month: 'long' }) : '');
</script>

{#if person && picking}
  <Pantalla accion="equipo" volver onback={() => (picking = null)} ojo={person.name} titulo={picking.role === 'fiscal' ? t('person.whichTable') : t('person.whichUnit')} desliza>
    <div class="items">
      {#each picking.places as place (place.id)}
        <button class="item" data-testid="place" onclick={() => placeChosen(place)}>
          <span class="item-texto"><strong>{place.name}</strong>
            {#if picking.role === 'fiscal'}<small>{(place.fiscales ?? []).length ? (place.fiscales ?? []).map((fiscal) => fiscal.name).join(', ') : t('person.noFiscal')}</small>{/if}
          </span>
        </button>
      {/each}
    </div>
    {#if failed}<p class="problema" role="alert">{t('error.tryAgain')}</p>{/if}
  </Pantalla>
{:else if person && adding}
  <Pantalla accion="equipo" volver onback={() => (adding = false)} ojo={person.name} titulo={t('person.addTask')} desliza>
    <Options items={roles} bind:value={newRole} />
    {#if failed}<p class="problema" role="alert">{t('error.tryAgain')}</p>{/if}
    {#snippet pie()}
      <button class="boton primario" disabled={!newRole} onclick={addTask}><Ic name="flecha" /><span>{t('next')}</span></button>
    {/snippet}
  </Pantalla>
{:else if person}
  <Pantalla accion="equipo" volver ojo={person.joined_at ? t('person.joined', { date: joinedOn }) : t('team.notJoined')} titulo={person.name} desliza>
    <div class="dos-campos">
      <label class="campo"><span>{t('person.name')}</span><input bind:value={name} data-testid="person-name" /></label>
      <label class="campo"><span>{t('person.phone')}</span><input bind:value={phone} type="tel" data-testid="person-phone" /></label>
    </div>
    <p class="etiqueta">{t('person.tasks')}</p>
    <div class="tarjetas">
      {#each person.roles as task (task.id)}
        <div class="tarjeta tarea" data-testid="task">
          <span class="tarea-texto"><strong>{taskTitle(task)}</strong><span>{taskDetail(task)}</span></span>
          <span class="renglon-botones">
            {#if PLACED.includes(task.role)}<button class="enlace" onclick={() => choosePlace(task.role, task)}>{t('person.change')}</button>{/if}
            <button class="enlace" onclick={() => removeTask(task)}>{t('person.remove')}</button>
          </span>
        </div>
      {/each}
    </div>
    <button class="boton secundario chico" data-testid="add-task" onclick={() => (adding = true)}><Ic name="mas" /><span>{t('person.addTask')}</span></button>
    {#if person.id !== session.me?.user.id}
      <div class="renglon-botones">
        <!-- Managing the team and inviting are two tasks: whoever only looks after the system does not invite. -->
        {#if session.allows('team.invite')}<button class="enlace" onclick={invite}>{t('team.invite')}</button>{/if}
        {#if person.joined}<button class="enlace" data-testid="lost-phone" onclick={lostPhone}>{t('person.lost')}</button>{/if}
        <button class="enlace peligro" onclick={removePerson}>{t('team.remove')}</button>
      </div>
    {/if}
    {#if failed}<p class="problema" role="alert">{t('error.tryAgain')}</p>{/if}
    {#snippet pie()}
      <button class="boton primario" disabled={!name.trim()} data-testid="person-save" onclick={save}><Ic name="tilde" /><span>{t('save')}</span></button>
    {/snippet}
  </Pantalla>
{:else}
  <Pantalla volver />
{/if}
