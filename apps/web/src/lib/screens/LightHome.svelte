<script lang="ts">
  import { onMount } from 'svelte';
  import Ic from '../components/Ic.svelte';
  import Options from '../components/Options.svelte';
  import Pantalla from '../components/Pantalla.svelte';
  import { t } from '../i18n.svelte.ts';
  import { nav } from '../nav.svelte.ts';
  import { autoPick, statusName, type OpenElection } from '../open-elections.ts';
  import { ApiError, session } from '../session.svelte.ts';

  interface Category {
    id: string;
    name: string;
    color: string;
    sensitive: boolean;
  }
  interface Person {
    /** The id phones know the person by. The roll id, which can be the whole document, stays on the server. */
    id: string;
    name: string;
    order: number | null;
    table: string | null;
    category: string | null;
  }

  let elections = $state.raw<OpenElection[]>([]);
  let election = $state<OpenElection | null>(null);
  /** With several elections and none clearly under way, the person says which one. */
  let choosing = $state(false);
  let categories = $state.raw<Category[]>([]);
  let query = $state('');
  let people = $state.raw<Person[]>([]);
  let person = $state<Person | null>(null);
  let choice = $state<string | null>(null);
  let offline = $state(false);
  let failed = $state<'signal' | 'sensitive' | null>(null);
  let searchTimer: ReturnType<typeof setTimeout> | undefined;

  onMount(async () => {
    try {
      elections = (await session.api<{ elections: OpenElection[] }>('/open-elections')).elections;
      election = autoPick(elections);
      choosing = !election && elections.length > 1;
      categories = (await session.api<{ categories: Category[] }>('/semaphore/categories')).categories;
    } catch {
      offline = true;
    }
  });

  async function search() {
    if (!election) return;
    try {
      people = (await session.api<{ people: Person[] }>(`/elections/${election.id}/people?q=${encodeURIComponent(query)}`)).people;
      offline = false;
    } catch {
      offline = true;
    }
  }

  function pick(chosen: OpenElection) {
    election = chosen;
    choosing = false;
    query = '';
    people = [];
  }

  function typed() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(search, 300);
  }

  function open(found: Person) {
    person = found;
    choice = found.category;
    failed = null;
  }

  /** It is only edited with signal, so that two people never hold different versions of it. */
  async function save() {
    if (!election || !person) return;
    try {
      await session.api(`/elections/${election.id}/people/${encodeURIComponent(person.id)}/semaphore`, { method: 'PUT', body: { category: choice } });
      person = null;
      query = '';
      people = [];
    } catch (error) {
      failed = error instanceof ApiError && error.code === 'sensitive_mark' ? 'sensitive' : 'signal';
    }
  }

  const items = $derived(categories.map((category) => ({ id: category.id, title: category.name, color: category.color })));
</script>

{#if choosing}
  <Pantalla accion="equipo" volver={nav.current.name !== 'home'} titulo={t('light.pick')} desliza>
    <div class="tarjetas">
      {#each elections as option (option.id)}
        <button class="tarjeta eleccion" data-testid="pick-election" onclick={() => pick(option)}>
          <strong>{option.name}</strong>
          <span>{t(statusName(option.status))}</span>
        </button>
      {/each}
    </div>
    {#snippet pie()}
      <button class="enlace" onclick={() => nav.go('settings')}>{t('plan.settings')}</button>
    {/snippet}
  </Pantalla>
{:else if person}
  <Pantalla accion="equipo" volver onback={() => (person = null)} ojo={t('light.eyebrow')} titulo={person.name} bajada={person.table ? t('light.where', { table: person.table, order: person.order ?? '' }) : ''} desliza>
    <Options {items} bind:value={choice} />
    {#if choice}<button class="enlace" onclick={() => (choice = null)}>{t('light.clear')}</button>{/if}
    {#if failed}<p class="problema" role="alert">{t(failed === 'sensitive' ? 'light.sensitiveMark' : 'light.needSignal')}</p>{/if}
    {#snippet pie()}
      <button class="boton primario" onclick={save}><Ic name="flecha" /><span>{t('light.save')}</span></button>
    {/snippet}
  </Pantalla>
{:else}
  <Pantalla accion="equipo" volver={nav.current.name !== 'home' || elections.length > 1} onback={elections.length > 1 ? () => (choosing = true) : undefined} ojo={election?.name ?? ''} titulo={t('light.title')} bajada={t('light.text')} desliza>
    {#if offline}<p class="estado envio"><span class="foco"></span>{t('light.needSignal')}</p>{/if}
    {#if categories.length === 0 && !offline}<p class="aviso-suave">{t('light.empty')}</p>{/if}
    <label class="buscar">
      <Ic name="lupa" />
      <input type="search" bind:value={query} oninput={typed} placeholder={t('light.search')} aria-label={t('light.search')} autocomplete="off" />
    </label>
    <div class="tarjetas compactas">
      {#each people as found (found.id)}
        <button class="tarjeta fila-mesa" data-testid="light-person" onclick={() => open(found)}>
          <strong>{found.name}</strong>
          <span>{categories.find((category) => category.id === found.category)?.name ?? found.table ?? ''}</span>
        </button>
      {/each}
    </div>
    {#snippet pie()}
      <button class="enlace" onclick={() => nav.go('settings')}>{t('plan.settings')}</button>
    {/snippet}
  </Pantalla>
{/if}
