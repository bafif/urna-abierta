<script lang="ts">
  import { onMount } from 'svelte';
  import Ic from '../components/Ic.svelte';
  import Keypad from '../components/Keypad.svelte';
  import Pantalla from '../components/Pantalla.svelte';
  import Qr from '../components/Qr.svelte';
  import { t } from '../i18n.svelte.ts';
  import { ApiError, session } from '../session.svelte.ts';

  let enrolment = $state<{ enrolled: boolean; secret?: string; url?: string } | null>(null);
  let code = $state('');
  let problem = $state('');
  let showing = $state(true);

  onMount(async () => {
    enrolment = await session.api('/auth/second-factor/start', { method: 'POST' });
    showing = !enrolment?.enrolled;
  });

  async function verify() {
    problem = '';
    try {
      await session.api('/auth/second-factor/verify', { method: 'POST', body: { code } });
      await session.refresh();
    } catch (error) {
      problem = error instanceof ApiError && error.status === 429 ? t('welcome.tooMany') : t('second.wrong');
      code = '';
    }
  }
</script>

{#if enrolment && showing && enrolment.url}
  <Pantalla accion="seguridad" titulo={t('second.setup.title')} bajada={t('second.setup.text')} desliza>
    <Qr text={enrolment.url} />
    <p class="aclara centrado">{t('second.setup.manual')}</p>
    <p class="codigo chico" data-testid="totp-secret">{enrolment.secret}</p>
    {#snippet pie()}
      <button class="boton primario" onclick={() => (showing = false)}><Ic name="flecha" /><span>{t('next')}</span></button>
    {/snippet}
  </Pantalla>
{:else if enrolment}
  <Pantalla accion="seguridad" titulo={t('second.title')} bajada={t('second.text')}>
    <Keypad bind:value={code} code={true} />
    {#if problem}<p class="problema" role="alert">{problem}</p>{/if}
    {#snippet pie()}
      <button class="boton primario" disabled={code.length !== 6} onclick={verify}><Ic name="tilde" /><span>{t('second.confirm')}</span></button>
    {/snippet}
  </Pantalla>
{/if}
