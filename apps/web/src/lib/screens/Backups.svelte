<script lang="ts">
  import { onMount } from 'svelte';
  import Pantalla from '../components/Pantalla.svelte';
  import { i18n, t } from '../i18n.svelte.ts';
  import { API, session } from '../session.svelte.ts';

  let backups = $state.raw<{ name: string; bytes: number; at: string }[]>([]);
  let loaded = $state(false);

  onMount(async () => {
    backups = (await session.api<{ backups: typeof backups }>('/backups')).backups;
    loaded = true;
  });

  async function download(name: string) {
    const response = await session.fetch(`${API}/backups/${name}`);
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
  }

  const when = (at: string) => new Date(at).toLocaleString(i18n.language, { dateStyle: 'short', timeStyle: 'short' });
</script>

<Pantalla accion="seguridad" volver titulo={t('backups.title')} bajada={t('backups.text')} desliza>
  {#if loaded && backups.length === 0}<p class="aviso-suave">{t('backups.none')}</p>{/if}
  <div class="tarjetas compactas">
    {#each backups as backup (backup.name)}
      <button class="tarjeta fila-mesa" data-testid="backup" onclick={() => download(backup.name)}>
        <strong>{when(backup.at)}</strong><span>{Math.max(1, Math.round(backup.bytes / 1_048_576))} MB</span>
      </button>
    {/each}
  </div>
</Pantalla>
