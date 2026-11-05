<script lang="ts">
  import { foldText, type RollEntry } from '@urna-abierta/domain';
  import Ic from '../components/Ic.svelte';
  import Pantalla from '../components/Pantalla.svelte';
  import VirtualList from '../components/VirtualList.svelte';
  import { app } from '../app.svelte.ts';
  import { t } from '../i18n.svelte.ts';

  let query = $state('');
  /** Taking a mark back asks once: a finger slips easily on a list. */
  let asking = $state<RollEntry | null>(null);

  const list = $derived.by(() => {
    void app.revision;
    const folded = foldText(query.trim());
    return app.electors.filter((entry) => app.voted(entry.id) && (folded === '' || entry.search.includes(folded)));
  });

  function takeBack() {
    if (asking) void app.undo(asking.id);
    asking = null;
  }
</script>

<Pantalla accion="tachar" volver titulo={t('voted.title')} bajada={t('voted.count', { count: app.markedCount })}>
  <label class="buscar">
    <Ic name="lupa" />
    <input type="search" bind:value={query} placeholder={t('roll.search')} aria-label={t('roll.search')} autocomplete="off" />
  </label>
  {#if list.length > 0}
    <div class="lista">
      <VirtualList items={list} rowHeight={62}>
        {#snippet row(entry: RollEntry)}
          <button class="fila tachada" data-testid="voted-person" onclick={() => (asking = entry)}>
            <span class="num">{entry.order}</span>
            <span class="nombre"><span class="nombre-t">{entry.name}</span></span>
            <span class="doc">…{entry.documentSuffix}</span>
          </button>
        {/snippet}
      </VirtualList>
    </div>
  {:else}
    <p class="centrado">{t('roll.empty')}</p>
  {/if}
  {#if asking}
    <div class="deshacer" role="status">
      <span>{t('voted.takeBack', { name: asking.name })}</span>
      <button onclick={takeBack}>{t('voted.confirm')}</button>
    </div>
  {/if}
</Pantalla>
