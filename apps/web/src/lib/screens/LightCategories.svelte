<script lang="ts">
  import { onMount } from 'svelte';
  import Ic from '../components/Ic.svelte';
  import Pantalla from '../components/Pantalla.svelte';
  import { t } from '../i18n.svelte.ts';
  import { session } from '../session.svelte.ts';

  interface Category {
    id: string;
    name: string;
    color: string;
    sensitive: boolean;
  }

  const COLORS = ['#1E9E5A', '#E8A317', '#D93A3A', '#2E6FD9', '#7A4BC2', '#6B7280'];

  let categories = $state.raw<Category[]>([]);
  /** Sensitive categories this person may not see: only how many. */
  let hidden = $state(0);
  let name = $state('');
  let color = $state(COLORS[0]!);
  let sensitive = $state(false);
  let fiscalView = $state(session.me?.security.fiscalView ?? false);
  /** The category being edited, and how many people have it. */
  let editing = $state<Category | null>(null);
  let people = $state(0);
  let failed = $state('');
  const allowed = $derived(session.me?.security.fiscalSeesSemaphore ?? false);
  const seesSensitive = $derived(session.allows('semaphore.sensitive'));

  async function setFiscalView(enabled: boolean) {
    await session.api('/semaphore/fiscal-view', { method: 'PUT', body: { enabled } });
    fiscalView = enabled;
    await session.refresh();
  }

  const load = async () => {
    const answer = await session.api<{ categories: Category[]; hidden?: number }>('/semaphore/categories');
    categories = answer.categories;
    hidden = answer.hidden ?? 0;
  };
  onMount(load);

  async function add() {
    await session.api('/semaphore/categories', { method: 'POST', body: { name, color, sensitive } });
    name = '';
    sensitive = false;
    await load();
  }

  async function open(category: Category) {
    editing = { ...category };
    failed = '';
    people = (await session.api<{ people: number }>(`/semaphore/categories/${category.id}`)).people;
  }

  async function save() {
    if (!editing) return;
    failed = '';
    try {
      await session.api(`/semaphore/categories/${editing.id}`, { method: 'PUT', body: { name: editing.name, color: editing.color, sensitive: editing.sensitive } });
      editing = null;
      await load();
    } catch {
      failed = t('error.tryAgain');
    }
  }

  async function remove() {
    if (!editing || !confirm(t('categories.delete.confirm', { name: editing.name }))) return;
    await session.api(`/semaphore/categories/${editing.id}`, { method: 'DELETE' });
    editing = null;
    await load();
  }

  /** One place up or down: the order is the one the traffic light shows. */
  async function move(index: number, by: number) {
    const order = [...categories];
    const [moved] = order.splice(index, 1);
    order.splice(index + by, 0, moved!);
    categories = order;
    await session.api('/semaphore/order', { method: 'PUT', body: { ids: order.map((category) => category.id) } });
  }
</script>

{#if editing}
  {@const before = categories.find((category) => category.id === editing!.id)}
  <Pantalla accion="equipo" volver onback={() => (editing = null)} ojo={t('categories.title')} titulo={t('categories.edit')} desliza>
    <label class="campo"><span>{t('categories.name')}</span><input bind:value={editing.name} maxlength="60" data-testid="category-name" /></label>
    <div class="renglon-botones" role="radiogroup" aria-label={t('categories.color')}>
      {#each COLORS as option}
        <button class="opcion" style:width="56px" style:min-height="52px" style:display="grid" style:place-items="center" style:grid-template-columns="1fr" class:elegida={editing.color === option} role="radio" aria-checked={editing.color === option} aria-label={option} onclick={() => (editing!.color = option)}>
          <span class="luz" style:background={option}></span>
        </button>
      {/each}
    </div>
    <label class="casilla"><input type="checkbox" bind:checked={editing.sensitive} disabled={before?.sensitive && !seesSensitive} data-testid="category-sensitive" /><span>{t('categories.sensitive.long')}</span></label>
    {#if editing.sensitive && !before?.sensitive && people > 0}
      <p class="aclara" data-testid="category-seal-note">{t('categories.sealNote', { count: people })}</p>
    {/if}
    {#if before?.sensitive && !seesSensitive}<p class="aclara">{t('categories.unsealNeeds')}</p>{/if}
    <div class="zona-peligro">
      <button class="boton discreto-peligro chico" disabled={people > 0} onclick={remove}>{t('categories.delete')}</button>
      <p class="aclara">{t('categories.delete.note')}</p>
    </div>
    {#if failed}<p class="problema" role="alert">{failed}</p>{/if}
    {#snippet pie()}
      <button class="boton primario" disabled={!editing!.name.trim()} data-testid="category-save" onclick={save}><Ic name="tilde" /><span>{t('save')}</span></button>
    {/snippet}
  </Pantalla>
{:else}
  <Pantalla accion="equipo" volver titulo={t('categories.title')} bajada={t('categories.text')} desliza>
    <div class="items">
      {#each categories as category, index (category.id)}
        <div class="item">
          <span class="luz" style:background={category.color} style:display="inline-block" style:width="18px" style:height="18px"></span>
          <button class="item-texto enlace-fila" data-testid="category" onclick={() => open(category)}><strong>{category.name}</strong>{#if category.sensitive}<small>{t('categories.sensitive')}</small>{/if}</button>
          <span class="renglon-botones">
            <button class="enlace" aria-label={t('categories.up')} disabled={index === 0} onclick={() => move(index, -1)}>↑</button>
            <button class="enlace" aria-label={t('categories.down')} disabled={index === categories.length - 1} onclick={() => move(index, 1)}>↓</button>
          </span>
        </div>
      {/each}
      {#if hidden > 0}
        <div class="item sellado" data-testid="category-hidden"><span class="item-texto"><strong>{t('categories.hidden', { count: hidden })}</strong><small>{t('categories.hidden.text')}</small></span></div>
      {/if}
    </div>
    <label class="campo"><span>{t('categories.name')}</span><input bind:value={name} data-testid="category-new" /></label>
    <div class="renglon-botones" role="radiogroup" aria-label={t('categories.color')}>
      {#each COLORS as option}
        <button class="opcion" style:width="56px" style:min-height="52px" style:display="grid" style:place-items="center" style:grid-template-columns="1fr" class:elegida={color === option} role="radio" aria-checked={color === option} aria-label={option} onclick={() => (color = option)}>
          <span class="luz" style:background={option}></span>
        </button>
      {/each}
    </div>
    <label class="casilla"><input type="checkbox" bind:checked={sensitive} /><span>{t('categories.sensitive.check')}</span></label>
    <button class="boton secundario" disabled={!name.trim()} onclick={add}><Ic name="mas" /><span>{t('categories.add')}</span></button>
    {#if allowed}
      <label class="casilla separado"><input type="checkbox" checked={fiscalView} data-testid="fiscal-view" onchange={(event) => setFiscalView(event.currentTarget.checked)} /><span>{t('categories.fiscalView')}</span></label>
    {/if}
  </Pantalla>
{/if}
