<script lang="ts">
  import { onMount } from 'svelte';
  import Ic from '../components/Ic.svelte';
  import Pantalla from '../components/Pantalla.svelte';
  import { t } from '../i18n.svelte.ts';
  import { session } from '../session.svelte.ts';

  const COLORS = ['#1E9E5A', '#E8A317', '#D93A3A', '#2E6FD9', '#7A4BC2', '#6B7280'];

  let categories = $state.raw<{ id: string; name: string; color: string; sensitive: boolean }[]>([]);
  let name = $state('');
  let color = $state(COLORS[0]!);
  let sensitive = $state(false);
  let fiscalView = $state(session.me?.security.fiscalView ?? false);
  const allowed = $derived(session.me?.security.fiscalSeesSemaphore ?? false);

  async function setFiscalView(enabled: boolean) {
    await session.api('/semaphore/fiscal-view', { method: 'PUT', body: { enabled } });
    fiscalView = enabled;
    await session.refresh();
  }

  const load = async () => {
    categories = (await session.api<{ categories: typeof categories }>('/semaphore/categories')).categories;
  };
  onMount(load);

  async function add() {
    await session.api('/semaphore/categories', { method: 'POST', body: { name, color, sensitive } });
    name = '';
    sensitive = false;
    await load();
  }
</script>

<Pantalla accion="equipo" volver titulo={t('categories.title')} bajada={t('categories.text')} desliza>
  <div class="tarjetas compactas">
    {#each categories as category (category.id)}
      <div class="tarjeta fila-mesa"><strong><span class="luz" style:background={category.color} style:display="inline-block" style:width="16px" style:height="16px"></span> {category.name}</strong><span>{category.sensitive ? t('categories.sensitive') : ''}</span></div>
    {/each}
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
