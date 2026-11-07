<script lang="ts">
  import Ic from '../components/Ic.svelte';
  import Pantalla from '../components/Pantalla.svelte';
  import { t } from '../i18n.svelte.ts';
  import { ApiError, session } from '../session.svelte.ts';
  import Legal from './Legal.svelte';

  let name = $state('');
  let phone = $state('');
  let code = $state(session.setupCode);
  let accepted = $state(false);
  let problem = $state('');
  let working = $state(false);
  /** The legal text opens here, so that what was already written stays. */
  let reading = $state(false);
  const fromLink = session.setupCode !== '';

  async function create() {
    working = true;
    problem = '';
    try {
      await session.setup({ code, name, phone, accepted });
    } catch (error) {
      problem = error instanceof ApiError && error.status === 403 ? t('setup.wrongCode') : t('error.tryAgain');
    }
    working = false;
  }
</script>

{#if reading}
  <Legal onback={() => (reading = false)} />
{:else}
<Pantalla accion="partido" titulo={t('setup.title')} bajada={t('setup.text')} desliza>
  <label class="campo"><span>{t('setup.name')}</span><input bind:value={name} autocomplete="name" data-testid="setup-name" /></label>
  <label class="campo"><span>{t('setup.phone')}</span><input bind:value={phone} type="tel" autocomplete="tel" /></label>
  <p class="aclara">{t('person.phone.hint')}</p>
  {#if !fromLink}
    <label class="campo"><span>{t('setup.code')}</span><input bind:value={code} autocomplete="off" data-testid="setup-code" /></label>
  {/if}
  <label class="casilla">
    <input type="checkbox" bind:checked={accepted} data-testid="setup-accept" />
    <span>{t('setup.responsibility')}</span>
  </label>
  <button class="enlace" data-testid="setup-legal" onclick={() => (reading = true)}>{t('setup.readLegal')}</button>
  {#if problem}<p class="problema" role="alert">{problem}</p>{/if}
  {#snippet pie()}
    <button class="boton primario" disabled={working || !name.trim() || !code || !accepted} onclick={create}><Ic name="flecha" /><span>{t('hello.start')}</span></button>
  {/snippet}
</Pantalla>
{/if}
