<script lang="ts">
  import Ic from '../components/Ic.svelte';
  import Pantalla from '../components/Pantalla.svelte';
  import { i18n, t } from '../i18n.svelte.ts';
  import { legalBlocks } from '../legal.ts';
  import { nav } from '../nav.svelte.ts';

  /** From the first account, it goes back to what was already written. */
  let { onback }: { onback?: () => void } = $props();
  const blocks = $derived(legalBlocks(i18n.language));
  const close = () => (onback ? onback() : nav.back());
</script>

<Pantalla accion="seguridad" volver onback={close} ojo={t('legal.eyebrow')} titulo={t('legal.title')} bajada={t('legal.draft')} desliza>
  <div class="tarjetas" data-testid="legal-summary">
    <div class="tarjeta"><strong>{t('legal.party')}</strong><span>{t('legal.party.text')}</span></div>
    <div class="tarjeta"><strong>{t('legal.project')}</strong><span>{t('legal.project.text')}</span></div>
    <div class="tarjeta">
      <strong>{t('legal.law')}</strong>
      <span>{t('legal.law.sensitive')}</span>
      <span>{t('legal.law.rights')}</span>
      <span>{t('legal.law.abroad')}</span>
    </div>
  </div>
  <p class="aclara">{t('legal.below')}</p>
  <div class="texto-legal" data-testid="legal-text">
    {#each blocks as block}
      {#if block.kind === 'title'}<h2>{block.text}</h2>
      {:else if block.kind === 'item'}<p class="item-legal">· {block.text}</p>
      {:else if block.kind === 'note'}<p class="aclara">{block.text}</p>
      {:else}<p>{block.text}</p>{/if}
    {/each}
  </div>
  {#snippet pie()}
    <button class="boton primario" data-testid="legal-ok" onclick={close}><Ic name="tilde" /><span>{t('legal.ok')}</span></button>
  {/snippet}
</Pantalla>
