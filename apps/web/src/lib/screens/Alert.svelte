<script lang="ts">
  import { whatsappDigits } from '@urna-abierta/domain';
  import Ic from '../components/Ic.svelte';
  import Pantalla from '../components/Pantalla.svelte';
  import { app } from '../app.svelte.ts';
  import { t } from '../i18n.svelte.ts';
  import { session } from '../session.svelte.ts';

  let result = $state<'idle' | 'sending' | 'sent' | 'queued' | 'unsaved'>('idle');

  const contact = $derived(session.me?.contact ?? null);
  const name = $derived(contact?.name.split(' ')[0] ?? '');
  const phone = $derived(contact?.phone?.trim() ?? '');
  const digits = $derived(whatsappDigits(phone));
  const message = $derived(encodeURIComponent(t('alert.message', { table: app.table?.name ?? '' })));
  // Without a phone to call or write to, the text does not point at buttons that are not there.
  const problem = $derived(
    result === 'queued' ? (phone ? t('alert.notSent') : t('alert.notSent.alone')) : phone ? t('alert.notSaved') : t('alert.notSaved.alone'),
  );

  async function report() {
    result = 'sending';
    result = await app.reportIncident();
    if (app.practice) result = 'sent';
  }
</script>

<Pantalla accion="aviso" volver titulo={t('alert.title')} bajada={contact ? t('alert.helper', { name }) : ''} desliza>
  {#if result === 'sent'}
    <p class="resultado bien" role="status"><Ic name="tilde" />{phone ? t('alert.sent', { name }) : t('alert.sent.noPhone')}</p>
  {:else if result === 'queued' || result === 'unsaved'}
    <p class="aviso-fuerte" role="alert">{problem}</p>
    {#if digits}
      <a class="boton secundario" href="https://wa.me/{digits}?text={message}">{t('alert.whatsapp')}</a>
    {/if}
    {#if phone}
      <a class="boton secundario" href="sms:{phone}?&body={message}">{t('alert.sms')}</a>
    {/if}
  {:else if phone}
    <div class="tarjeta dato"><span>{t('alert.noSignal')}</span></div>
  {/if}
  {#snippet pie()}
    <div class="pila">
      {#if phone}
        <a class="boton peligro" href="tel:{phone}"><Ic name="tel" /><span>{t('alert.call', { name })}</span></a>
      {/if}
      <button class="boton secundario" data-testid="report" disabled={result === 'sending'} onclick={report}><Ic name="aviso" /><span>{contact ? t('alert.send', { name }) : t('alert.sendAnyone')}</span></button>
    </div>
  {/snippet}
</Pantalla>
