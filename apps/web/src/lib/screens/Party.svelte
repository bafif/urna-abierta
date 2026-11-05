<script lang="ts">
  import Ic from '../components/Ic.svelte';
  import Pantalla from '../components/Pantalla.svelte';
  import { t } from '../i18n.svelte.ts';
  import { nav } from '../nav.svelte.ts';
  import { session } from '../session.svelte.ts';
  import { ui } from '../ui.svelte.ts';

  let name = $state(session.me?.party.name ?? '');
  let failed = $state(false);

  async function save() {
    failed = false;
    try {
      await session.api('/party', { method: 'PUT', body: { name, theme: session.me?.party.theme ?? ui.theme.id } });
      await session.refresh();
      nav.back();
    } catch {
      failed = true;
    }
  }
</script>

<Pantalla accion="partido" volver titulo={t('party.title')}>
  <label class="campo"><input bind:value={name} aria-label={t('party.name')} data-testid="party-name" /></label>
  {#if failed}<p class="problema" role="alert">{t('error.tryAgain')}</p>{/if}
  {#snippet pie()}
    <button class="boton primario" disabled={!name.trim()} onclick={save}><Ic name="flecha" /><span>{t('next')}</span></button>
  {/snippet}
</Pantalla>
