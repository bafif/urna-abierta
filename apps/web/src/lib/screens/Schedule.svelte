<script lang="ts">
  import { onMount } from 'svelte';
  import Pantalla from '../components/Pantalla.svelte';
  import { formatDay, formatDayShort, t } from '../i18n.svelte.ts';
  import { session } from '../session.svelte.ts';
  import { scheduleText, type Schedule } from '../schedule.ts';

  interface Fiscal {
    name: string;
    phone: string | null;
    days: string[] | null;
    schedule: Schedule | null;
  }
  interface Row {
    id: string;
    name: string;
    place: string;
    unit: string | null;
    chief: string | null;
    fiscales: Fiscal[];
  }
  interface Answer {
    name: string;
    days: string[];
    hours: Record<string, { open: string; close: string }>;
    tables: Row[];
  }

  let { election }: { election: string } = $props();
  let answer = $state.raw<Answer | null>(null);
  let day = $state('');
  let failed = $state(false);

  onMount(async () => {
    try {
      answer = await session.api<Answer>(`/elections/${election}/schedule`);
      day = answer.days[0] ?? '';
    } catch {
      failed = true;
    }
  });

  /** The poll watchers of a table that day: those of every day, and those of a shift that includes it. */
  const onDay = (row: Row) => row.fiscales.filter((fiscal) => !fiscal.days || fiscal.days.includes(day));
  const missing = $derived((answer?.tables ?? []).filter((row) => onDay(row).length === 0).length);
  const words = () => ({ from: t('schedule.from'), arrive: t('schedule.arrive'), meet: t('schedule.meet') });

  /** One row per table and poll watcher, for the day on screen: to print or hand out. */
  function download() {
    const cell = (value: string) => (/[",;\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : /^[=+\-@]/.test(value) ? `'${value}` : value);
    const rows = [[t('schedule.sheet.table'), t('schedule.sheet.place'), t('schedule.sheet.fiscal'), t('schedule.sheet.phone'), t('schedule.sheet.times'), t('schedule.sheet.chief')]];
    for (const row of answer!.tables) {
      const fiscales = onDay(row);
      if (fiscales.length === 0) rows.push([row.name, row.place, t('schedule.noFiscal'), '', '', row.chief ?? '']);
      for (const fiscal of fiscales) rows.push([row.name, row.place, fiscal.name, fiscal.phone ?? '', scheduleText(fiscal.schedule, words()), row.chief ?? '']);
    }
    const url = URL.createObjectURL(new Blob([`\uFEFF${rows.map((row) => row.map(cell).join(',')).join('\r\n')}\r\n`], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${t('schedule.sheet.file')}-${day}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }
</script>

<Pantalla accion="eleccion" volver ojo={answer?.name ?? ''} titulo={answer ? t('schedule.title', { day: formatDay(day) }) : ''} desliza>
  {#if answer}
    {#if answer.hours[day]}<p class="aclara" data-testid="schedule-hours">{t('schedule.hours', { open: answer.hours[day]!.open, close: answer.hours[day]!.close })}</p>{/if}
    {#if answer.days.length > 1}
      <div class="modos">
        {#each answer.days as item (item)}
          <button class="modo" aria-pressed={item === day} onclick={() => (day = item)}>{formatDayShort(item)}</button>
        {/each}
      </div>
    {/if}
    {#if missing > 0}<p class="problema" data-testid="schedule-missing">{t('schedule.missing', { count: missing })}</p>{/if}
    <div class="items">
      {#each answer.tables as row (row.id)}
        <div class="item" class:falta={onDay(row).length === 0} data-testid="schedule-row">
          <span class="item-texto">
            <strong>{row.name}{row.place ? ` · ${row.place}` : ''}</strong>
            {#each onDay(row) as fiscal}
              <small>{fiscal.name}{fiscal.schedule ? ` · ${scheduleText(fiscal.schedule, words())}` : ''}</small>
            {:else}
              <small>{t('schedule.noFiscal')}</small>
            {/each}
            {#if row.chief}<small>{t('schedule.chief', { name: row.chief })}</small>{/if}
          </span>
        </div>
      {/each}
    </div>
  {:else if failed}
    <p class="problema" role="alert">{t('error.tryAgain')}</p>
  {/if}
  {#snippet pie()}
    {#if answer}
      <div class="par-filas">
        <button class="boton secundario" data-testid="schedule-download" onclick={download}>{t('schedule.download')}</button>
        <button class="boton secundario" onclick={() => window.print()}>{t('schedule.print')}</button>
      </div>
    {/if}
  {/snippet}
</Pantalla>
