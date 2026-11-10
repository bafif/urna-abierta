<script lang="ts">
  import { onMount } from 'svelte';
  import Pantalla from '../components/Pantalla.svelte';
  import { actionName, formatDay, i18n, t } from '../i18n.svelte.ts';
  import { session } from '../session.svelte.ts';

  interface Entry {
    id: number;
    at: string;
    action: string;
    who: string | null;
    about: string | null;
    about_table: string | null;
    people: number | null;
    seen: boolean;
  }

  let entries = $state.raw<Entry[]>([]);
  let finished = $state(false);
  let kind = $state<'' | 'seen' | 'changed'>('');
  let who = $state('');
  let query = $state('');
  let counts = $state<{ seen: number; changed: number } | null>(null);
  let people = $state.raw<string[]>([]);

  /** Who appears in what is loaded, to filter by them. */
  const names = $derived([...new Set(entries.map((entry) => entry.who).filter(Boolean))] as string[]);

  function path(before?: number): string {
    const params = new URLSearchParams();
    if (before) params.set('before', String(before));
    if (kind) params.set('kind', kind);
    if (query.trim().length >= 3) params.set('q', query.trim());
    return `/audit${params.size ? `?${params}` : ''}`;
  }

  async function load(more = false) {
    const answer = await session.api<{ entries: Entry[]; counts?: { seen: number; changed: number }; people?: string[] }>(path(more ? entries.at(-1)?.id : undefined));
    entries = more ? [...entries, ...answer.entries] : answer.entries;
    finished = answer.entries.length < 100;
    if (!more) {
      counts = answer.counts ?? null;
      people = answer.people ?? [];
    }
  }
  onMount(() => load());

  const shown = $derived(who ? entries.filter((entry) => entry.who === who) : entries);
  const dayOf = (at: string) => new Date(at).toLocaleDateString('sv');
  const time = (at: string) => new Date(at).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' });
  /** What it was about: a person of the roll and their table, a table, an election, someone on the team, or how many people it showed. */
  const about = (entry: Entry) =>
    [entry.about, entry.about_table, entry.people ? t('audit.people', { count: entry.people }) : ''].filter(Boolean).join(' · ');

  /** What is on screen, as a spreadsheet: for a request, everything about that person. */
  function download() {
    const cell = (value: string) => (/[",;\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : /^[=+\-@]/.test(value) ? `'${value}` : value);
    const rows = [[t('audit.sheet.when'), t('audit.sheet.who'), t('audit.sheet.what'), t('audit.sheet.about')]];
    for (const entry of shown) rows.push([new Date(entry.at).toLocaleString(i18n.language), entry.who ?? t('audit.system'), actionName(entry.action), about(entry)]);
    const url = URL.createObjectURL(new Blob([`\uFEFF${rows.map((row) => row.map(cell).join(',')).join('\r\n')}\r\n`], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${t('audit.sheet.file')}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }
</script>

<Pantalla accion="seguridad" volver titulo={t('audit.title')} bajada={t('audit.text')} desliza>
  <div class="dos-campos">
    <label class="campo"><span>{t('audit.who')}</span>
      <select bind:value={who} data-testid="audit-who"><option value="">{t('audit.who.all')}</option>{#each names as name}<option value={name}>{name}</option>{/each}</select>
    </label>
    <label class="campo"><span>{t('audit.kind')}</span>
      <select bind:value={kind} onchange={() => load()} data-testid="audit-kind">
        <option value="">{t('audit.kind.all')}</option><option value="seen">{t('audit.kind.seen')}</option><option value="changed">{t('audit.kind.changed')}</option>
      </select>
    </label>
  </div>
  <label class="campo"><span>{t('audit.person')}</span>
    <input type="search" bind:value={query} placeholder={t('audit.person.hint')} data-testid="audit-person" onkeydown={(event) => event.key === 'Enter' && load()} onchange={() => load()} />
  </label>
  {#if counts}
    <p class="resultado bien" data-testid="audit-counts">{people.join(', ')}: {t('audit.counts.seen', { count: counts.seen })} · {t('audit.counts.changed', { count: counts.changed })}</p>
  {/if}
  <ul class="registro">
    {#each shown as entry, index (entry.id)}
      {#if index === 0 || dayOf(entry.at) !== dayOf(shown[index - 1]!.at)}<li class="dia-registro"><strong>{formatDay(dayOf(entry.at))}</strong></li>{/if}
      <li data-testid="audit-entry">
        <span><b>{entry.who ?? t('audit.system')}</b>: {actionName(entry.action)}{#if about(entry)}<small class="sobre">{about(entry)}</small>{/if}</span>
        <small>{time(entry.at)}</small>
      </li>
    {/each}
  </ul>
  {#if !finished && entries.length > 0}<button class="enlace" onclick={() => load(true)}>{t('audit.more')}</button>{/if}
  {#snippet pie()}
    <button class="boton secundario" data-testid="audit-download" disabled={shown.length === 0} onclick={download}>{t('audit.download')}</button>
  {/snippet}
</Pantalla>
