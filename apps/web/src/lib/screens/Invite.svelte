<script lang="ts">
  import { whatsappDigits } from '@urna-abierta/domain';
  import Ic from '../components/Ic.svelte';
  import Pantalla from '../components/Pantalla.svelte';
  import Qr from '../components/Qr.svelte';
  import { t } from '../i18n.svelte.ts';
  import { nav } from '../nav.svelte.ts';
  import { inviteLink, session } from '../session.svelte.ts';

  let { name, phone, token }: { name: string; phone?: string | null; token: string } = $props();

  let copied = $state(false);
  const link = $derived(inviteLink(token));
  const firstName = $derived(name.split(' ')[0] ?? '');
  const digits = $derived(whatsappDigits(phone));
  const message = $derived(t('invite.message', { name: firstName, party: session.me?.party.name ?? '', link }));

  async function copy() {
    await navigator.clipboard.writeText(link);
    copied = true;
    setTimeout(() => (copied = false), 3_000);
  }
</script>

<Pantalla accion="equipo" volver titulo={t('invite.title', { name: firstName })} bajada={t('invite.text')} desliza>
  <Qr text={link} />
  <output class="oculto" data-testid="invite-link">{link}</output>
  {#snippet pie()}
    <div class="pila">
      {#if digits}
        <a class="boton primario" href="https://wa.me/{digits}?text={encodeURIComponent(message)}"><Ic name="sobre" /><span>{t('invite.whatsapp')}</span></a>
      {:else if 'share' in navigator}
        <button class="boton primario" onclick={() => navigator.share({ text: message })}><Ic name="sobre" /><span>{t('invite.share')}</span></button>
      {/if}
      <button class="boton secundario" onclick={copy}>{copied ? t('invite.copied') : t('invite.copy')}</button>
      <button class="enlace" onclick={() => nav.back()}>{t('invite.done')}</button>
    </div>
  {/snippet}
</Pantalla>
