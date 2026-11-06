<script lang="ts">
  import Ic from '../components/Ic.svelte';
  import Options from '../components/Options.svelte';
  import Pantalla from '../components/Pantalla.svelte';
  import { i18n, t } from '../i18n.svelte.ts';
  import { nav } from '../nav.svelte.ts';
  import { session } from '../session.svelte.ts';

  let step = $state<'kind' | 'days' | 'voted'>('kind');
  let kind = $state<string | null>('estudiantil');
  let name = $state('');
  let days = $state<string[]>([]);
  let groups = $state([{ name: '', lists: '' }]);
  let failed = $state(false);

  const now = new Date();
  let month = $state(new Date(now.getFullYear(), now.getMonth(), 1));

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
      const { id } = await session.api<{ id: string }>('/elections', { method: 'POST', body: { name, kind, days, categories: categories() } });
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
  <Pantalla accion="eleccion" volver ojo={t('election.new')} titulo={t('election.kind.title')} desliza>
    <Options items={kinds} bind:value={kind} />
    <label class="campo"><span>{t('election.name')}</span><input bind:value={name} placeholder={t('election.name.hint')} data-testid="election-name" /></label>
    {#snippet pie()}
      <button class="boton primario" disabled={!name.trim()} onclick={() => (step = 'days')}><Ic name="flecha" /><span>{t('next')}</span></button>
    {/snippet}
  </Pantalla>
{:else if step === 'days'}
  <Pantalla accion="eleccion" volver onback={() => (step = 'kind')} titulo={t('election.days.title')} bajada={t('election.days.text')} desliza>
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
    {#snippet pie()}
      <button class="boton primario" disabled={days.length === 0} onclick={() => (step = 'voted')}><Ic name="flecha" /><span>{t('next')}</span></button>
    {/snippet}
  </Pantalla>
{:else}
  <Pantalla accion="eleccion" volver onback={() => (step = 'days')} titulo={t('election.voted.title')} bajada={t('election.voted.text')} desliza>
    {#each groups as group}
      <label class="campo"><span>{t('election.voted.category')}</span><input bind:value={group.name} placeholder={t('election.voted.categoryHint')} data-testid="category-name" /></label>
      <label class="campo"><span>{t('election.voted.lists')}</span><textarea bind:value={group.lists} placeholder={t('election.voted.listsHint')} data-testid="category-lists"></textarea></label>
    {/each}
    <button class="enlace" onclick={() => groups.push({ name: '', lists: '' })}>{t('election.voted.another')}</button>
    {#if failed}<p class="problema" role="alert">{t('error.tryAgain')}</p>{/if}
    {#snippet pie()}
      <button class="boton primario" disabled={!ready} onclick={create}><Ic name="tilde" /><span>{t('election.create')}</span></button>
    {/snippet}
  </Pantalla>
{/if}
