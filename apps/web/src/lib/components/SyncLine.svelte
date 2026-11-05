<script lang="ts">
  import { app } from '../app.svelte.ts';
  import { t } from '../i18n.svelte.ts';

  const pending = $derived(app.pendingCount + app.pendingPhotos);
</script>

{#if app.ready && !app.storageBroken && app.electors.length > 0 && !app.practice}
  <p class="estado envio" data-testid="sync-status">
    <span class="foco"></span>
    {#if pending === 0}
      {t('sync.done')}
    {:else if app.sending && app.online}
      {t('sync.sending')}
    {:else}
      {t('sync.pending', { count: pending })}
    {/if}
  </p>
{/if}
