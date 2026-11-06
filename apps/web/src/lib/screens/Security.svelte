<script lang="ts">
  import Ic from '../components/Ic.svelte';
  import Options from '../components/Options.svelte';
  import Pantalla from '../components/Pantalla.svelte';
  import { t } from '../i18n.svelte.ts';
  import { nav } from '../nav.svelte.ts';
  import { isSecurityProfile, stricterProfile } from '@urna-abierta/domain';
  import { ApiError, session } from '../session.svelte.ts';

  // What the party chose, never the profile an open election holds for now: saving it as is must not make that one stay.
  let profile = $state<string | null>(session.me?.security.choice ?? session.me?.security.profile ?? 'estudiantil');
  const minimum = session.me?.security.minimum;
  const held = $derived(isSecurityProfile(profile) && isSecurityProfile(minimum) && stricterProfile(profile, minimum) !== profile);
  let failed = $state<'signal' | 'held' | null>(null);

  const items = $derived([
    { id: 'estudiantil', title: t('security.student.title'), detail: t('security.student.detail') },
    { id: 'local', title: t('security.local.title'), detail: t('security.local.detail') },
    { id: 'nacional', title: t('security.national.title'), detail: t('security.national.detail') },
  ]);

  async function save() {
    failed = null;
    try {
      await session.api('/security', { method: 'PUT', body: { profile } });
      await session.refresh();
      nav.back();
    } catch (error) {
      failed = error instanceof ApiError && error.code === 'election_needs_more' ? 'held' : 'signal';
    }
  }
</script>

<Pantalla accion="seguridad" volver titulo={t('security.title')} bajada={t('security.text')}>
  <Options {items} bind:value={profile} />
  {#if failed}<p class="problema" role="alert">{t(failed === 'held' ? 'security.held' : 'error.tryAgain')}</p>
  {:else if held}<p class="aclara" data-testid="security-held">{t('security.held')}</p>{/if}
  {#snippet pie()}
    <button class="boton primario" onclick={save}><Ic name="flecha" /><span>{t('next')}</span></button>
  {/snippet}
</Pantalla>
