<script lang="ts">
  import { onMount } from 'svelte';
  import Pantalla from '../components/Pantalla.svelte';
  import { t } from '../i18n.svelte.ts';
  import { session } from '../session.svelte.ts';

  interface Row {
    id: string;
    full_name: string;
    document: string | null;
  }

  let { election }: { election: string } = $props();
  let rows = $state<Row[]>([]);
  let loaded = $state(false);

  onMount(async () => {
    rows = (await session.api<{ rows: Row[] }>(`/elections/${election}/review`)).rows;
    loaded = true;
  });

  /** Nothing doubtful is dropped silently: a person looks at it, and confirming is enough if it was fine. */
  async function confirmRow(row: Row) {
    await session.api(`/elections/${election}/electors/${encodeURIComponent(row.id)}`, { method: 'PUT', body: { full_name: row.full_name, document: row.document } });
    rows = rows.filter((other) => other.id !== row.id);
  }
</script>

<Pantalla accion="eleccion" volver titulo={rows.length ? t('review.title', { count: rows.length }) : loaded ? t('review.none') : ''} bajada={rows.length ? t('review.text') : ''} desliza>
  {#each rows as row (row.id)}
    <div class="tarjeta" data-testid="review-row">
      <label class="campo"><span>{t('review.name')}</span><input bind:value={row.full_name} /></label>
      <label class="campo"><span>{t('review.document')}</span><input bind:value={row.document} inputmode="numeric" /></label>
      <button class="enlace" onclick={() => confirmRow(row)}>{t('review.ok')}</button>
    </div>
  {/each}
</Pantalla>
