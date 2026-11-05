<script lang="ts">
  import Ic from '../components/Ic.svelte';
  import Pantalla from '../components/Pantalla.svelte';
  import { t } from '../i18n.svelte.ts';
  import { ApiError, session } from '../session.svelte.ts';

  let code = $state('');
  let problem = $state('');
  let trying = $state(false);

  async function enter() {
    trying = true;
    problem = '';
    try {
      await session.redeem(code.replace(/\D/g, ''));
      await session.refresh();
    } catch (error) {
      problem = error instanceof ApiError ? (error.status === 429 ? t('welcome.tooMany') : t('welcome.wrongCode')) : t('welcome.noSignal');
    }
    trying = false;
  }

  async function retry() {
    trying = true;
    await session.usePendingInvitation();
    await session.refresh();
    trying = false;
  }
</script>

<Pantalla titulo={t('welcome.title')} bajada={t('welcome.text')} desliza>
  {#if session.invitationProblem === 'used'}
    <p class="aviso-fuerte" role="alert" data-testid="invitation-used">{t('welcome.used')}</p>
  {:else if session.invitationProblem === 'no_signal'}
    <div class="aviso-fuerte" role="alert">
      <span>{t('welcome.needSignal')}</span>
      <button class="boton secundario" disabled={trying} onclick={retry}>{t('space.retry')}</button>
    </div>
  {/if}
  <label class="campo">
    <span>{t('welcome.codeLabel')}</span>
    <input bind:value={code} inputmode="numeric" autocomplete="one-time-code" data-testid="code" />
  </label>
  {#if problem}<p class="problema" role="alert">{problem}</p>{/if}
  {#snippet pie()}
    <button class="boton primario" disabled={trying || code.replace(/\D/g, '').length < 8} onclick={enter}><Ic name="flecha" /><span>{t('welcome.enter')}</span></button>
  {/snippet}
</Pantalla>
