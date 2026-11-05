<script lang="ts">
  import { app } from '../app.svelte.ts';
  import { t } from '../i18n.svelte.ts';
  import { pwa } from '../pwa.svelte.ts';

  const pending = $derived(app.pendingCount + app.pendingPhotos);
</script>

{#if app.practice || pwa.waitingWorker || app.noRoom || app.saveFailed || app.dataLost}
  <div class="avisos">
    {#if app.practice}
      <div class="aviso-suave" data-testid="practice">
        <span>{t('practice.notice')}</span>
        <button class="enlace" onclick={() => app.endPractice()}>{t('practice.leave')}</button>
      </div>
    {/if}
    {#if pwa.waitingWorker}
      <div class="aviso-suave">
        {#if pending === 0}
          <span>{t('update.available')}</span>
          <button class="enlace" onclick={() => pwa.update()}>{t('update.apply')}</button>
        {:else}
          <span>{t('update.waiting')}</span>
        {/if}
      </div>
    {/if}
    {#if app.noRoom}
      <div class="aviso-fuerte" role="alert" data-testid="no-room">
        <span>{t('space.low')}</span>
        <button class="boton secundario" disabled={app.checkingRoom} onclick={() => app.checkRoom()}>
          {app.checkingRoom ? t('space.checking') : t('space.retry')}
        </button>
      </div>
    {:else if app.saveFailed}
      <p class="aviso-fuerte" role="alert" data-testid="save-failed">{t('save.failed')}</p>
    {/if}
    {#if app.dataLost}
      <p class="aviso-fuerte" role="alert" data-testid="data-lost">{t('storage.lost')}</p>
    {/if}
  </div>
{/if}
