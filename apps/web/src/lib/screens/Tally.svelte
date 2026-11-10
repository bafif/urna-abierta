<script lang="ts">
  import Ic from '../components/Ic.svelte';
  import Keypad from '../components/Keypad.svelte';
  import Pantalla from '../components/Pantalla.svelte';
  import { app } from '../app.svelte.ts';
  import { untrack } from 'svelte';
  import { t } from '../i18n.svelte.ts';
  import { nav } from '../nav.svelte.ts';
  import { session } from '../session.svelte.ts';

  /** The category whose tally is being corrected, if this is a correction. */
  let { correcting }: { correcting?: string } = $props();

  const DRAFT_KEY = 'urna-abierta-escrutinio';

  /** Counting takes a long time: if the phone turns off halfway, nothing already typed is lost. */
  const saved = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? '{}') as Record<string, Record<string, string>>;
  let drafts = $state<Record<string, Record<string, string>>>(saved);
  let index = $state(0);
  let failed = $state(false);
  // A correction starts from what was sent, and is not kept as a draft: leaving it changes nothing.
  const before = untrack(() => (correcting ? app.lastTally(correcting) : null));
  let fixes = $state<Record<string, string>>(Object.fromEntries(Object.entries(before ?? {}).map(([list, votes]) => [list, String(votes)])));

  const category = $derived(
    app.table?.categories.find((item) => (correcting ? item.id === correcting : !app.talliedCategories.has(item.id))) ?? null,
  );
  const lists = $derived(category?.lists ?? []);
  const reviewing = $derived(index >= lists.length);
  const current = $derived(lists[index]);
  const values = $derived(correcting ? fixes : category ? (drafts[category.id] ?? {}) : {});
  const totalBefore = $derived(Object.values(before ?? {}).reduce((sum, votes) => sum + votes, 0));
  const chief = $derived(session.me?.contact?.name.split(' ')[0] ?? '');
  const totalVotes = $derived(lists.reduce((sum, list) => sum + Number(values[list.id] ?? 0), 0));
  const envelopes = $derived(app.lastEnvelopes);

  function setValue(value: string) {
    if (!category || !current) return;
    if (correcting) {
      fixes = { ...fixes, [current.id]: value };
      return;
    }
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
    if (correcting) {
      app.noteCorrection();
      nav.home();
      return;
    }
    delete drafts[saved];
    localStorage.setItem(DRAFT_KEY, JSON.stringify($state.snapshot(drafts)));
    index = 0;
    if (!app.table?.categories.some((item) => !app.talliedCategories.has(item.id))) nav.replace('photo');
  }
</script>

{#if !category}
  <Pantalla accion="escrutinio" volver titulo={t('tally.done')} />
{:else if reviewing}
  <Pantalla accion="escrutinio" volver aviso onback={back} ojo={correcting ? t('correct.of', { what: category.name }) : category.name} titulo={t('tally.review.title')} desliza>
    <div class="tarjetas compactas">
      {#each lists as list}
        {@const old = before?.[list.id] ?? 0}
        <div class="tarjeta fila-mesa"><strong>{list.name}</strong><span>{#if before && old !== Number(values[list.id] ?? 0)}<s class="antes">{old}</s>{/if}{values[list.id] ?? 0}</span></div>
      {/each}
      <div class="tarjeta fila-mesa"><strong>{t('tally.review.total')}</strong><span data-testid="tally-total">{#if before && totalBefore !== totalVotes}<s class="antes">{totalBefore}</s>{/if}{totalVotes}</span></div>
    </div>
    {#if envelopes !== null}
      {#if envelopes === totalVotes}
        <p class="resultado bien"><Ic name="tilde" />{t('tally.review.match', { count: envelopes })}</p>
      {:else}
        <p class="resultado mal" data-testid="tally-differs">{t('tally.review.differ', { envelopes, votes: totalVotes })}</p>
      {/if}
    {/if}
    {#if app.electors.length > 0 && totalVotes > app.electors.length}
      <p class="resultado mal" data-testid="tally-over-roll">{t('tally.review.overRoll', { votes: totalVotes, people: app.electors.length })}</p>
    {/if}
    {#if correcting}<p class="aviso-suave">{chief ? t('correct.tell', { name: chief }) : t('correct.tell.noName')}</p>{/if}
    {#if failed}<p class="problema" role="alert">{t('save.failedShort')}</p>{/if}
    {#snippet pie()}
      <button class="boton primario" onclick={save}><Ic name="tilde" /><span>{correcting ? t('correct.save') : t('save')}</span></button>
    {/snippet}
  </Pantalla>
{:else if current}
  <Pantalla
    accion="escrutinio"
    volver
    aviso
    onback={back}
    ojo={correcting ? t('correct.of', { what: t('tally.eyebrow', { category: category.name, n: index + 1, total: lists.length }) }) : t('tally.eyebrow', { category: category.name, n: index + 1, total: lists.length })} titulo={t('tally.question', { list: current.name })}>
    {#key current.id}
      <Keypad bind:value={() => values[current.id] ?? '', setValue} />
    {/key}
    {#snippet pie()}
      <button class="boton primario" onclick={() => (index += 1)}><Ic name="flecha" /><span>{t('next')}</span></button>
    {/snippet}
  </Pantalla>
{/if}
