<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import Pantalla from '../components/Pantalla.svelte';
  import { i18n, t } from '../i18n.svelte.ts';
  import { resultsCsv, shareOf, type ResultCategory, type Results, type ResultsByTable } from '../results.ts';
  import { session } from '../session.svelte.ts';

  const REFRESH_MS = 30_000;

  let { election }: { election: string } = $props();
  let results = $state.raw<Results | null>(null);
  let chosen = $state('');
  let problem = $state(false);
  let downloading = $state(false);
  let timer: ReturnType<typeof setInterval> | undefined;

  async function load() {
    try {
      results = await session.api<Results>(`/elections/${election}/results`);
      problem = false;
    } catch {
      problem = true;
    }
  }
  onMount(() => {
    void load();
    timer = setInterval(load, REFRESH_MS);
  });
  onDestroy(() => clearInterval(timer));

  const category = $derived(results?.categories.find((item) => item.id === chosen) ?? results?.categories[0]);
  const finished = $derived(Boolean(results && category && category.counted === results.tables));
  const number = (value: number) => value.toLocaleString(i18n.language);

  /** Which tables are not added up, and why: the tally did not arrive, or two of them wait for someone to choose. */
  function leftOut(item: ResultCategory): string {
    const count = item.missing + item.undecided;
    if (item.missing > 0 && item.undecided > 0) return t('results.missing.both', { count, missing: item.missing, undecided: item.undecided });
    return t(item.missing > 0 ? 'results.missing.noTally' : 'results.missing.undecided', { count });
  }

  /** Table by table, as a spreadsheet. The server logs who downloaded it. */
  async function download() {
    downloading = true;
    try {
      const sheet = await session.api<ResultsByTable>(`/elections/${election}/results?tables=1`);
      const text = resultsCsv(sheet, {
        table: t('results.sheet.table'), category: t('results.sheet.category'), list: t('results.sheet.list'), votes: t('results.sheet.votes'),
        undecided: t('results.sheet.undecided'), missing: t('results.sheet.missing'),
      });
      const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `${t('results.sheet.file')}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      problem = false;
    } catch {
      problem = true;
    }
    downloading = false;
  }
</script>

<Pantalla volver ojo={finished ? t('results.final') : t('results.provisional')} desliza>
  {#snippet encabezado()}
    {#if results && category}
      <span class="faltan" data-testid="results-counted">{category.counted}</span>
      <span class="de">{t('results.of', { count: results.tables })}</span>
    {:else if problem}
      {t('error.tryAgain')}
    {/if}
  {/snippet}
  {#if results && category}
    {#if results.categories.length > 1}
      <div class="modos">
        {#each results.categories as item (item.id)}
          <button class="modo" aria-pressed={item.id === category.id} onclick={() => (chosen = item.id)}>{item.name}</button>
        {/each}
      </div>
    {/if}
    <div class="barras" data-testid="results">
      {#each category.lists as list (list.id)}
        <div class="barra"><span>{list.name}</span><i style="--v:{shareOf(list.votes, category)}%"></i><b>{number(list.votes)} · {shareOf(list.votes, category)} %</b></div>
      {/each}
    </div>
    <p class="aclara" data-testid="results-left-out">{finished ? t('results.allIn') : leftOut(category)}</p>
    <p class="aclara">{t('results.note')}</p>
    {#if problem}<p class="problema" role="alert">{t('error.tryAgain')}</p>{/if}
  {/if}
  {#snippet pie()}
    {#if results}
      <button class="boton secundario" data-testid="results-download" disabled={downloading} onclick={download}>{t('results.download')}</button>
    {/if}
  {/snippet}
</Pantalla>
