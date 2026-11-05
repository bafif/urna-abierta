<script lang="ts">
  import { onMount } from 'svelte';
  import Pantalla from '../components/Pantalla.svelte';
  import { actionName, i18n, t } from '../i18n.svelte.ts';
  import { session } from '../session.svelte.ts';

  let entries = $state.raw<{ id: number; at: string; action: string; who: string | null }[]>([]);
  let finished = $state(false);

  async function more() {
    const before = entries.at(-1)?.id;
    const page = (await session.api<{ entries: typeof entries }>(`/audit${before ? `?before=${before}` : ''}`)).entries;
    entries = [...entries, ...page];
    finished = page.length === 0;
  }
  onMount(more);

  const when = (at: string) => new Date(at).toLocaleString(i18n.language, { dateStyle: 'short', timeStyle: 'short' });
</script>

<Pantalla accion="seguridad" volver titulo={t('audit.title')} bajada={t('audit.text')} desliza>
  <ul class="registro">
    {#each entries as entry (entry.id)}
      <li data-testid="audit-entry"><span>{entry.who ?? t('audit.system')}: {actionName(entry.action)}</span><small>{when(entry.at)}</small></li>
    {/each}
  </ul>
  {#if !finished && entries.length > 0}<button class="enlace" onclick={more}>{t('audit.more')}</button>{/if}
</Pantalla>
