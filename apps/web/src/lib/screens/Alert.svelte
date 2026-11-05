<script lang="ts">
  import Ic from '../components/Ic.svelte';
  import Pantalla from '../components/Pantalla.svelte';
  import { app } from '../app.svelte.ts';
  import { t } from '../i18n.svelte.ts';
  import { session } from '../session.svelte.ts';

  let result = $state<'idle' | 'sending' | 'sent' | 'queued' | 'unsaved'>('idle');

  const contact = $derived(session.me?.contact ?? null);
  const name = $derived(contact?.name.split(' ')[0] ?? '');
  const digits = $derived(contact?.phone?.replace(/\D/g, '') ?? '');
  const message = $derived(encodeURIComponent(t('alert.message', { table: app.table?.name ?? '' })));

  async function report() {
    result = 'sending';
    result = await app.reportIncident();
    if (app.practice) result = 'sent';
  }
</script>

<Pantalla accion="aviso" volver titulo={t('alert.title')} bajada={contact ? t('alert.helper', { name }) : ''} desliza>
  {#if result === 'sent'}
    <p class="resultado bien" role="status"><Ic name="tilde" />{t('alert.sent', { name })}</p>
  {:else if result === 'queued' || result === 'unsaved'}
    <p class="aviso-fuerte" role="alert">{result === 'queued' ? t('alert.notSent') : t('alert.notSaved')}</p>
    {#if digits}
      <a class="boton secundario" href="https://wa.me/{digits}?text={message}">{t('alert.whatsapp')}</a>
      <a class="boton secundario" href="sms:{contact?.phone}?&body={message}">{t('alert.sms')}</a>
    {/if}
  {:else}
    <div class="tarjeta dato"><span>{t('alert.noSignal')}</span></div>
  {/if}
  {#snippet pie()}
    <div class="pila">
      {#if contact?.phone}
        <a class="boton peligro" href="tel:{contact.phone}"><Ic name="tel" /><span>{t('alert.call', { name })}</span></a>
      {/if}
      <button class="boton secundario" data-testid="report" disabled={result === 'sending'} onclick={report}><Ic name="aviso" /><span>{contact ? t('alert.send', { name }) : t('alert.sendAnyone')}</span></button>
    </div>
  {/snippet}
</Pantalla>
