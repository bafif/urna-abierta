<script lang="ts">
  import { onMount } from 'svelte';
  import Ic from '../components/Ic.svelte';
  import Pantalla from '../components/Pantalla.svelte';
  import { t } from '../i18n.svelte.ts';
  import { session } from '../session.svelte.ts';

  interface Row {
    id: string;
    full_name: string;
    document: string | null;
    file_number: string | null;
    table_name: string | null;
  }
  interface Doubtful extends Row {
    twin: Row | null;
  }

  let { election }: { election: string } = $props();
  let rows = $state.raw<Doubtful[]>([]);
  let total = $state(0);
  let preparing = $state(false);
  let loaded = $state(false);
  /** For two rows with one document: null until the person answers whether they are the same. */
  let same = $state<boolean | null>(null);
  let name = $state('');
  let document = $state('');
  let failed = $state(false);

  async function load() {
    const answer = await session.api<{ rows: Doubtful[]; total: number; status: string | null }>(`/elections/${election}/review`);
    rows = answer.rows;
    total = answer.total;
    preparing = answer.status === 'preparacion';
    loaded = true;
    same = null;
    name = rows[0]?.full_name ?? '';
    document = rows[0]?.document ?? '';
  }
  onMount(load);

  const current = $derived(rows[0]);
  /** Why it is here: the document of another row, a document that could not be read, or something else to look at. */
  const reason = $derived(!current ? null : current.twin ? 'same' : !current.document || !/^\d{7,8}$/.test(current.document) ? 'document' : 'other');
  const differs = (field: keyof Row) => Boolean(current?.twin && (current[field] ?? '') !== (current.twin[field] ?? ''));

  async function run(action: () => Promise<unknown>) {
    failed = false;
    try {
      await action();
      await load();
    } catch {
      failed = true;
    }
  }

  /** Nothing doubtful is dropped silently: a person looks at it, and confirming is enough if it was fine. */
  const keep = (row: Row, fullName = row.full_name, doc = row.document) =>
    session.api(`/elections/${election}/electors/${encodeURIComponent(row.id)}`, { method: 'PUT', body: { full_name: fullName, document: doc } });
  const drop = (row: Row) => session.api(`/elections/${election}/electors/${encodeURIComponent(row.id)}`, { method: 'DELETE' });

  /** The same person twice: the chosen row stays, confirmed, and the other leaves the roll. */
  const stays = (chosen: Row, other: Row) => run(async () => {
    await drop(other);
    await keep(chosen);
  });
</script>

{#if current}
  <Pantalla accion="eleccion" volver ojo={t('review.title', { count: total })} titulo={t(`review.reason.${reason}` as Parameters<typeof t>[0])} desliza>
    {#if reason === 'same' && current.twin}
      {@const twin = current.twin}
      <div class="par-filas" data-testid="review-pair">
        {#each [current, twin] as row (row.id)}
          <div class="tarjeta">
            <strong class:distinto={differs('full_name')}>{row.full_name}</strong>
            <span>{t('review.document')}: <b class:distinto={differs('document')}>{row.document ?? '—'}</b></span>
            {#if row.file_number || twin.file_number}<span>{t('review.fileNumber')}: <b class:distinto={differs('file_number')}>{row.file_number ?? '—'}</b></span>{/if}
            {#if row.table_name}<span>{row.table_name}</span>{/if}
          </div>
        {/each}
      </div>
      {#if same === null}
        <p class="etiqueta">{t('review.same.question')}</p>
        <div class="pila">
          <button class="boton secundario" data-testid="review-same" disabled={!preparing} onclick={() => (same = true)}>{t('review.same.yes')}</button>
          <button class="boton secundario" data-testid="review-different" onclick={() => (same = false)}>{t('review.same.no')}</button>
        </div>
        {#if !preparing}<p class="aclara">{t('review.onlyPreparing')}</p>{/if}
      {:else if same}
        <p class="etiqueta">{t('review.same.which')}</p>
        <div class="pila">
          <button class="boton secundario" data-testid="review-keep-first" onclick={() => stays(current, twin)}>{t('review.keep', { name: current.full_name })}</button>
          <button class="boton secundario" onclick={() => stays(twin, current)}>{t('review.keep', { name: twin.full_name })}</button>
        </div>
      {:else}
        <p class="aclara">{t('review.different.text')}</p>
        <label class="campo"><span>{t('review.document')} · {current.full_name}</span><input bind:value={document} inputmode="numeric" data-testid="review-document" /></label>
      {/if}
    {:else}
      <label class="campo"><span>{t('review.name')}</span><input bind:value={name} data-testid="review-name" /></label>
      <label class="campo"><span>{t('review.document')}</span><input bind:value={document} inputmode="numeric" data-testid="review-document" /></label>
      {#if reason === 'other' && preparing}
        <button class="enlace peligro" data-testid="review-drop" onclick={() => run(() => drop(current))}>{t('review.notAPerson')}</button>
      {/if}
    {/if}
    {#if failed}<p class="problema" role="alert">{t('error.tryAgain')}</p>{/if}
    {#snippet pie()}
      {#if reason !== 'same' || same === false}
        <button class="boton primario" data-testid="review-next" disabled={reason !== 'same' && !name.trim()}
          onclick={() => run(() => (reason === 'same' ? keep(current, current.full_name, document) : keep(current, name.trim(), document)))}>
          <Ic name="flecha" /><span>{t('review.next')}</span>
        </button>
      {/if}
    {/snippet}
  </Pantalla>
{:else}
  <Pantalla accion="eleccion" volver titulo={loaded ? t('review.none') : ''} />
{/if}
