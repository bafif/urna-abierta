<script lang="ts">
  import Pantalla from '../components/Pantalla.svelte';
  import { app } from '../app.svelte.ts';
  import { t } from '../i18n.svelte.ts';
  import { session } from '../session.svelte.ts';
  import { ui } from '../ui.svelte.ts';
  import AdminHome from './AdminHome.svelte';
  import ChooseTheme from './ChooseTheme.svelte';
  import District from './District.svelte';
  import FiscalPlan from './FiscalPlan.svelte';
  import Hello from './Hello.svelte';
  import LightHome from './LightHome.svelte';
  import More from './More.svelte';
  import Numbers from './Numbers.svelte';
  import SecondFactor from './SecondFactor.svelte';
  import Setup from './Setup.svelte';
  import Welcome from './Welcome.svelte';

  const HELLO_KEY = 'urna-abierta-bienvenida';

  let greeted = $state(localStorage.getItem(HELLO_KEY) !== null);
  let hasChosen = $state(ui.hasChosen);

  function greet() {
    localStorage.setItem(HELLO_KEY, new Date().toISOString());
    greeted = true;
  }
</script>

{#if !session.ready}
  <Pantalla />
{:else if app.storageBroken}
  <Pantalla titulo={t('storage.title')}>
    <p class="aviso-fuerte" role="alert" data-testid="storage-broken">{t('storage.broken')}</p>
  </Pantalla>
{:else if app.practice}
  <FiscalPlan />
{:else if session.revoked}
  <Pantalla titulo={t('revoked.title')} bajada={t('revoked.text')}>
    {#snippet pie()}
      <button class="enlace" onclick={() => session.forget()}>{t('revoked.other')}</button>
    {/snippet}
  </Pantalla>
{:else if !session.token}
  {#if session.setupNeeded}
    <Setup />
  {:else if session.unreachable && !session.invitationProblem}
    <Pantalla titulo={t('welcome.noServer')} bajada={t('welcome.noServer.text')}>
      {#snippet pie()}
        <button class="boton primario" onclick={() => session.refresh()}>{t('space.retry')}</button>
      {/snippet}
    </Pantalla>
  {:else}
    <Welcome />
  {/if}
{:else if session.me?.secondFactorNeeded}
  <SecondFactor />
{:else if !session.me}
  <Pantalla titulo={t('welcome.noServer')} bajada={t('welcome.noServer.text')}>
    {#snippet pie()}
      <button class="boton primario" onclick={() => session.refresh()}>{t('space.retry')}</button>
    {/snippet}
  </Pantalla>
{:else if !greeted && !session.allows('election.manage', 'security.manage')}
  <Hello onstart={greet} />
{:else if !hasChosen}
  <ChooseTheme first onchosen={() => (hasChosen = true)} />
{:else if session.home === 'fiscalPlan'}
  <FiscalPlan />
{:else if session.home === 'district'}
  <District />
{:else if session.home === 'adminHome'}
  <AdminHome />
{:else if session.home === 'more'}
  <More inicio />
{:else if session.home === 'lightHome'}
  <LightHome />
{:else if session.home === 'numbers'}
  <Numbers />
{:else}
  <Pantalla titulo={t('noRole.title')} bajada={t('noRole.text')} />
{/if}
