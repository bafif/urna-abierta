<script lang="ts">
  import Ic from '../components/Ic.svelte';
  import Options from '../components/Options.svelte';
  import Pantalla from '../components/Pantalla.svelte';
  import { app } from '../app.svelte.ts';
  import { formatDayChoice, formatDayShort, t } from '../i18n.svelte.ts';
  import { nav } from '../nav.svelte.ts';

  type Choice = { id: string; title: string; detail?: string };
  const OTHER_DAY = 'otro-dia';

  let choice = $state<string | null>(null);
  let pickingDay = $state(false);

  const days = $derived([...app.countedDays].sort());
  const earlier = $derived(days.slice(0, -1));
  const tallied = $derived(app.table?.categories.filter((category) => app.talliedCategories.has(category.id)) ?? []);

  // Each option says what was entered, so that it is recognised without thinking.
  const envelopes = (day: string): Choice => ({
    id: `sobres:${day}`,
    title: t('correct.envelopes', { day: formatDayShort(day) }),
    detail: t('correct.envelopes.detail', { count: app.envelopesOf(day)?.envelopes ?? 0 }),
  });

  const items = $derived.by((): Choice[] => {
    if (pickingDay) return earlier.map(envelopes);
    const list: Choice[] = days.length > 0 ? [envelopes(days[days.length - 1]!)] : [];
    if (earlier.length > 0) list.push({ id: OTHER_DAY, title: t('correct.otherDay'), detail: formatDayChoice(earlier) });
    for (const category of tallied) {
      const votes = Object.values(app.lastTally(category.id) ?? {}).reduce((sum, count) => sum + count, 0);
      list.push({ id: `escrutinio:${category.id}`, title: t('correct.tally', { category: category.name }), detail: t('correct.tally.detail', { count: votes }) });
    }
    return list;
  });

  function go() {
    if (!choice) return;
    if (choice === OTHER_DAY) {
      pickingDay = true;
      choice = null;
      return;
    }
    const cut = choice.indexOf(':');
    nav.go(choice.slice(0, cut) === 'sobres' ? 'envelopes' : 'tally', { correcting: choice.slice(cut + 1) });
  }

  function back() {
    if (!pickingDay) return nav.back();
    pickingDay = false;
    choice = null;
  }
</script>

<Pantalla volver onback={back} ojo={t('correct.eyebrow')} titulo={pickingDay ? t('correct.whichDay') : t('correct.title')} bajada={pickingDay ? undefined : t('correct.text')} desliza>
  <Options {items} bind:value={choice} />
  {#snippet pie()}
    <button class="boton primario" disabled={!choice} onclick={go}><Ic name="lapiz" /><span>{t('correct.go')}</span></button>
  {/snippet}
</Pantalla>
