<script lang="ts">
  import Ic from '../components/Ic.svelte';
  import Keypad from '../components/Keypad.svelte';
  import Pantalla from '../components/Pantalla.svelte';
  import { app } from '../app.svelte.ts';
  import { t } from '../i18n.svelte.ts';
  import { nav } from '../nav.svelte.ts';

  const DRAFT_KEY = 'urna-abierta-escrutinio';

  /** Counting takes a long time: if the phone turns off halfway, nothing already typed is lost. */
  const saved = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? '{}') as Record<string, Record<string, string>>;
  let drafts = $state<Record<string, Record<string, string>>>(saved);
  let index = $state(0);
  let failed = $state(false);

  const category = $derived(app.table?.categories.find((item) => !app.talliedCategories.has(item.id)) ?? null);
  const lists = $derived(category?.lists ?? []);
  const reviewing = $derived(index >= lists.length);
  const current = $derived(lists[index]);
  const values = $derived(category ? (drafts[category.id] ?? {}) : {});
  const totalVotes = $derived(lists.reduce((sum, list) => sum + Number(values[list.id] ?? 0), 0));
  const envelopes = $derived(app.lastEnvelopes);

  function setValue(value: string) {
    if (!category || !current) return;
    drafts[category.id] = { ...values, [current.id]: value };
    localStorage.setItem(DRAFT_KEY, JSON.stringify($state.snapshot(drafts)));
  }

  function back() {
    if (index > 0) index -= 1;
    else nav.back();
  }

  async function save() {
    if (!category) return;
    // Saving moves on to the next category, so this one has to be held on to.
    const saved = category.id;
    const results = Object.fromEntries(lists.map((list) => [list.id, Number(values[list.id] ?? 0)]));
    failed = !(await app.submitTally(saved, results));
    if (failed) return;
    delete drafts[saved];
    localStorage.setItem(DRAFT_KEY, JSON.stringify($state.snapshot(drafts)));
    index = 0;
    if (!app.table?.categories.some((item) => !app.talliedCategories.has(item.id))) nav.replace('photo');
  }
</script>

{#if !category}
  <Pantalla accion="escrutinio" volver titulo={t('tally.done')} />
{:else if reviewing}
  <Pantalla accion="escrutinio" volver onback={back} ojo={category.name} titulo={t('tally.review.title')} desliza>
    <div class="tarjetas compactas">
      {#each lists as list}
        <div class="tarjeta fila-mesa"><strong>{list.name}</strong><span>{values[list.id] ?? 0}</span></div>
      {/each}
      <div class="tarjeta fila-mesa"><strong>{t('tally.review.total')}</strong><span data-testid="tally-total">{totalVotes}</span></div>
    </div>
    {#if envelopes !== null}
      {#if envelopes === totalVotes}
        <p class="resultado bien"><Ic name="tilde" />{t('tally.review.match', { count: envelopes })}</p>
      {:else}
        <p class="resultado mal" data-testid="tally-differs">{t('tally.review.differ', { envelopes, votes: totalVotes })}</p>
      {/if}
    {/if}
    {#if failed}<p class="problema" role="alert">{t('save.failedShort')}</p>{/if}
    {#snippet pie()}
      <button class="boton primario" onclick={save}><Ic name="tilde" /><span>{t('save')}</span></button>
    {/snippet}
  </Pantalla>
{:else if current}
  <Pantalla accion="escrutinio" volver onback={back} ojo={t('tally.eyebrow', { category: category.name, n: index + 1, total: lists.length })} titulo={t('tally.question', { list: current.name })}>
    {#key current.id}
      <Keypad bind:value={() => values[current.id] ?? '', setValue} />
    {/key}
    {#snippet pie()}
      <button class="boton primario" onclick={() => (index += 1)}><Ic name="flecha" /><span>{t('next')}</span></button>
    {/snippet}
  </Pantalla>
{/if}
