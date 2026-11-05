<script lang="ts">
  import { onMount } from 'svelte';
  import Pantalla from '../components/Pantalla.svelte';
  import { t } from '../i18n.svelte.ts';
  import { nav } from '../nav.svelte.ts';
  import { session } from '../session.svelte.ts';

  let code = $state('');

  onMount(async () => {
    try {
      code = (await session.api<{ code: string }>('/auth/handoff', { method: 'POST' })).code;
    } catch {
      code = '';
    }
  });

  const shown = $derived(code.replace(/(\d{4})(\d{4})/, '$1 $2'));

  function stayHere() {
    sessionStorage.setItem('urna-abierta-sin-instalar', '1');
    nav.back();
  }
</script>

<Pantalla volver titulo={t('iphone.title')} bajada={t('iphone.text')} desliza>
  <ol class="plan">
    <li class="estacion ahora"><span class="punto"></span><div><strong>{t('iphone.step1')}</strong></div></li>
    <li class="estacion ahora"><span class="punto"></span><div><strong>{t('iphone.step2')}</strong></div></li>
    <li class="estacion ahora"><span class="punto"></span><div><strong>{t('iphone.step3')}</strong></div></li>
  </ol>
  {#if code}
    <p class="codigo" data-testid="handoff-code">{shown}</p>
    <p class="aclara centrado">{t('iphone.valid')}</p>
  {/if}
  {#snippet pie()}
    <button class="enlace" onclick={stayHere}>{t('iphone.skip')}</button>
  {/snippet}
</Pantalla>
