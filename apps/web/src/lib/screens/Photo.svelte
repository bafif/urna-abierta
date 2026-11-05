<script lang="ts">
  import { onDestroy } from 'svelte';
  import Ic from '../components/Ic.svelte';
  import Pantalla from '../components/Pantalla.svelte';
  import { app } from '../app.svelte.ts';
  import { t } from '../i18n.svelte.ts';
  import { nav } from '../nav.svelte.ts';

  let preview = $state<string | null>(null);
  let saving = $state(false);
  let failed = $state(false);

  onDestroy(() => {
    if (preview) URL.revokeObjectURL(preview);
  });

  async function taken(event: Event & { currentTarget: HTMLInputElement }) {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    saving = true;
    failed = false;
    if (await app.addPhoto(file)) {
      if (preview) URL.revokeObjectURL(preview);
      preview = URL.createObjectURL(file);
    } else {
      failed = true;
    }
    saving = false;
  }
</script>

<Pantalla accion="escrutinio" volver ojo={t('photo.eyebrow')} titulo={t('photo.title')} bajada={t('photo.text')}>
  {#if preview}
    <img class="foto-acta" src={preview} alt={t('photo.alt')} />
  {:else}
    <div class="marco-foto"></div>
  {/if}
  {#if failed}<p class="problema" role="alert">{t('photo.failed')}</p>{/if}
  {#snippet pie()}
    <div class="pila">
      {#if preview}
        <button class="boton primario" onclick={() => nav.home()}><Ic name="tilde" /><span>{t('photo.finish')}</span></button>
      {/if}
      <label class={preview ? 'boton secundario' : 'boton primario'}>
        <input class="oculto" type="file" accept="image/*" capture="environment" data-testid="photo-input" onchange={taken} disabled={saving} />
        <Ic name="camara" /><span>{saving ? t('photo.saving') : preview ? t('photo.again') : t('photo.take')}</span>
      </label>
    </div>
  {/snippet}
</Pantalla>
