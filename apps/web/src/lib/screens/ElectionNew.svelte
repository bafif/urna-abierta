<script lang="ts">
  import { onMount } from 'svelte';
  import Ic from '../components/Ic.svelte';
  import Options from '../components/Options.svelte';
  import Pantalla from '../components/Pantalla.svelte';
  import { i18n, t } from '../i18n.svelte.ts';
  import { nav } from '../nav.svelte.ts';
  import { session } from '../session.svelte.ts';
  import type { ElectionSummary } from '../types.ts';
  import { addDays, KEEP_DAYS, type KeepChoice } from '../purge.ts';
  import { formatDay } from '../i18n.svelte.ts';

  /** With `edit`, the same steps change one part of an election that exists, starting from what it had. */
  let { edit, part }: { edit?: string; part?: 'name' | 'days' | 'lists' | 'keep' } = $props();
  const STEP_OF = { name: 'kind', days: 'days', lists: 'voted', keep: 'keep' } as const;
  // svelte-ignore state_referenced_locally
  let step = $state<'kind' | 'days' | 'voted' | 'keep'>(part ? STEP_OF[part] : 'kind');
  /** Until when the names are kept: a month after the last day comes chosen, the recommended for every level. */
  let keep = $state<KeepChoice>('month');
  let keepDate = $state('');
  let status = $state('');
  let kind = $state<string | null>('estudiantil');
  let name = $state('');
  let days = $state<string[]>([]);
  let groups = $state([{ name: '', lists: '' }]);
  let failed = $state(false);

  const now = new Date();
  let month = $state(new Date(now.getFullYear(), now.getMonth(), 1));
  /** The blank, spoiled and contested votes are in every count: a person only sees and writes the real lists. */
  const ALWAYS = ['blanco', 'nulo', 'recurrido'];

  onMount(async () => {
    if (!edit) return;
    const election = (await session.api<{ elections: ElectionSummary[] }>('/elections')).elections.find((item) => item.id === edit);
    if (!election) return;
    name = election.name;
    days = [...election.days];
    status = election.status;
    groups = election.categories.map((category) => ({ name: category.name, lists: category.lists.filter((list) => !ALWAYS.includes(list.id)).map((list) => list.name).join('\n') }));
    if (groups.length === 0) groups = [{ name: '', lists: '' }];
    const first = days[0];
    if (first) month = new Date(Number(first.slice(0, 4)), Number(first.slice(5, 7)) - 1, 1);
    if (election.purge_by) {
      const last = [...days].sort().at(-1) ?? '';
      const matching = (Object.keys(KEEP_DAYS) as (keyof typeof KEEP_DAYS)[]).find((choice) => addDays(last, KEEP_DAYS[choice]) === election.purge_by);
      keep = matching ?? 'other';
      keepDate = election.purge_by;
    }
  });

  const lastDay = $derived([...days].sort().at(-1) ?? '');
  const purgeBy = $derived(keep === 'other' ? keepDate : lastDay ? addDays(lastDay, KEEP_DAYS[keep]) : '');
  const keeps = $derived([
    { id: 'week', title: t('keep.week'), detail: t('keep.week.text') },
    { id: 'month', title: t('keep.month'), detail: t('keep.month.text') },
    { id: 'quarter', title: t('keep.quarter'), detail: t('keep.quarter.text') },
    { id: 'other', title: t('keep.other') },
  ]);

  /** Only the part that was asked for goes to the server. Moving a day already voted asks first. */
  async function save() {
    if (!edit) return;
    if (part === 'days' && status === 'jornada' && !confirm(t('electionEdit.days.confirm'))) return;
    failed = false;
    try {
      const body = part === 'name' ? { name: name.trim() } : part === 'days' ? { days } : part === 'keep' ? { purgeBy } : { categories: categories() };
      await session.api(`/elections/${edit}`, { method: 'PUT', body });
      nav.back();
    } catch {
      failed = true;
    }
  }

  const kinds = $derived([
    { id: 'estudiantil', title: t('security.student.title') },
    { id: 'local', title: t('security.local.title') },
    { id: 'nacional', title: t('security.national.title') },
    { id: 'otra', title: t('election.kind.other') },
  ]);

  const pad = (value: number) => String(value).padStart(2, '0');
  const iso = (day: number) => `${month.getFullYear()}-${pad(month.getMonth() + 1)}-${pad(day)}`;
  const monthName = $derived(month.toLocaleDateString(i18n.language, { month: 'long', year: 'numeric' }));
  const blanks = $derived((month.getDay() + 6) % 7);
  const inMonth = $derived(new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate());
  const weekdays = $derived(i18n.language === 'es' ? ['L', 'M', 'M', 'J', 'V', 'S', 'D'] : ['M', 'T', 'W', 'T', 'F', 'S', 'S']);

  const toggle = (day: string) => {
    days = days.includes(day) ? days.filter((item) => item !== day) : [...days, day].sort();
  };
  const move = (by: number) => {
    month = new Date(month.getFullYear(), month.getMonth() + by, 1);
  };

  const slug = (index: number, text: string) => `${index}-${text.normalize('NFD').replace(/[^\w]+/g, '-').toLowerCase().slice(0, 24)}`;

  /** A person only writes the real lists: blank, spoiled and contested votes are in every count. */
  function categories() {
    return groups
      .filter((group) => group.name.trim())
      .map((group, index) => ({
        id: slug(index, group.name),
        name: group.name.trim(),
        lists: [
          ...group.lists.split('\n').map((line) => line.trim()).filter(Boolean).map((list, position) => ({ id: slug(position, list), name: list })),
          { id: 'blanco', name: t('election.blank') },
          { id: 'nulo', name: t('election.spoiled') },
          { id: 'recurrido', name: t('election.contested') },
        ],
      }));
  }

  const ready = $derived(groups.some((group) => group.name.trim() && group.lists.trim()));

  async function create() {
    failed = false;
    try {
      const { id } = await session.api<{ id: string }>('/elections', { method: 'POST', body: { name, kind, days, categories: categories(), ...(purgeBy ? { purgeBy } : {}) } });
      // The server holds the level of care the election's kind asks for while it is open: this only shows it.
      await session.refresh();
      // That level may ask this device for a second step: the start screen asks for it before anything else.
      if (session.me?.secondFactorNeeded) nav.home();
      else nav.replace('election', { id });
    } catch {
      failed = true;
    }
  }
</script>

{#if step === 'kind'}
  <Pantalla accion="eleccion" volver ojo={edit ? t('electionEdit.eyebrow') : t('election.new')} titulo={edit ? t('election.name') : t('election.kind.title')} desliza>
    {#if !edit}<Options items={kinds} bind:value={kind} />{/if}
    <label class="campo"><span>{t('election.name')}</span><input bind:value={name} placeholder={t('election.name.hint')} data-testid="election-name" /></label>
    {#if failed}<p class="problema" role="alert">{t('error.tryAgain')}</p>{/if}
    {#snippet pie()}
      {#if edit}
        <button class="boton primario" disabled={!name.trim()} onclick={save}><Ic name="tilde" /><span>{t('save')}</span></button>
      {:else}
        <button class="boton primario" disabled={!name.trim()} onclick={() => (step = 'days')}><Ic name="flecha" /><span>{t('next')}</span></button>
      {/if}
    {/snippet}
  </Pantalla>
{:else if step === 'days'}
  <Pantalla accion="eleccion" volver onback={edit ? undefined : () => (step = 'kind')} titulo={t('election.days.title')} bajada={t('election.days.text')} desliza>
    <div class="mes-nav">
      <button aria-label={t('election.days.previous')} onclick={() => move(-1)}>‹</button>
      <strong>{monthName}</strong>
      <button aria-label={t('election.days.next')} onclick={() => move(1)}>›</button>
    </div>
    <div class="mes">
      {#each weekdays as weekday}<b>{weekday}</b>{/each}
      {#each { length: blanks } as _}<span></span>{/each}
      {#each { length: inMonth } as _, index}
        <button class:dia-elegido={days.includes(iso(index + 1))} aria-pressed={days.includes(iso(index + 1))} data-testid="day" onclick={() => toggle(iso(index + 1))}>{index + 1}</button>
      {/each}
    </div>
    {#if days.length > 0}
      <p class="resultado bien"><Ic name="tilde" />{days.length === 1 ? t('election.days.one') : t('election.days.many', { count: days.length })}</p>
    {/if}
    {#if failed}<p class="problema" role="alert">{t('error.tryAgain')}</p>{/if}
    {#snippet pie()}
      {#if edit}
        <button class="boton primario" disabled={days.length === 0} onclick={save}><Ic name="tilde" /><span>{t('save')}</span></button>
      {:else}
        <button class="boton primario" disabled={days.length === 0} onclick={() => (step = 'voted')}><Ic name="flecha" /><span>{t('next')}</span></button>
      {/if}
    {/snippet}
  </Pantalla>
{:else if step === 'voted'}
  <Pantalla accion="eleccion" volver onback={edit ? undefined : () => (step = 'days')} titulo={t('election.voted.title')} bajada={t('election.voted.text')} desliza>
    {#each groups as group}
      <label class="campo"><span>{t('election.voted.category')}</span><input bind:value={group.name} placeholder={t('election.voted.categoryHint')} data-testid="category-name" /></label>
      <label class="campo"><span>{t('election.voted.lists')}</span><textarea bind:value={group.lists} placeholder={t('election.voted.listsHint')} data-testid="category-lists"></textarea></label>
    {/each}
    <button class="enlace" onclick={() => groups.push({ name: '', lists: '' })}>{t('election.voted.another')}</button>
    {#if failed}<p class="problema" role="alert">{t('error.tryAgain')}</p>{/if}
    {#snippet pie()}
      {#if edit}
        <button class="boton primario" disabled={!ready} onclick={save}><Ic name="tilde" /><span>{t('save')}</span></button>
      {:else}
        <button class="boton primario" disabled={!ready} onclick={() => (step = 'keep')}><Ic name="flecha" /><span>{t('next')}</span></button>
      {/if}
    {/snippet}
  </Pantalla>
{:else}
  <Pantalla accion="eleccion" volver onback={edit ? undefined : () => (step = 'voted')} titulo={t('keep.title')} bajada={t('keep.text')} desliza>
    <Options items={keeps} bind:value={keep} />
    {#if keep === 'other'}
      <label class="campo"><span>{t('keep.date')}</span><input type="date" min={lastDay} bind:value={keepDate} data-testid="keep-date" /></label>
    {/if}
    {#if purgeBy}<p class="resultado bien" data-testid="keep-when"><Ic name="tilde" />{t('keep.when', { date: formatDay(purgeBy) })}</p>{/if}
    {#if failed}<p class="problema" role="alert">{t('error.tryAgain')}</p>{/if}
    {#snippet pie()}
      <button class="boton primario" disabled={!purgeBy || purgeBy < lastDay} onclick={edit ? save : create}><Ic name="tilde" /><span>{edit ? t('save') : t('election.create')}</span></button>
    {/snippet}
  </Pantalla>
{/if}
