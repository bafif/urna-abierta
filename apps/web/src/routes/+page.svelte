<script lang="ts">
  import { onMount } from 'svelte';
  import { resolve } from '$app/paths';
  import { foldText, type RollEntry } from '@urna-abierta/domain';
  import { app, TABLE_ID } from '../lib/app.svelte.ts';
  import { i18n, LANGUAGES, t, type Language } from '../lib/i18n.svelte.ts';
  import VirtualList from '../lib/components/VirtualList.svelte';

  type View = 'table' | 'urgent' | 'check';
  const SIZES = [350, 1000, 5000];

  let view = $state<View>('table');
  let size = $state(350);
  let preparing = $state(false);
  let prepareFailed = $state(false);
  let query = $state('');
  let showVoted = $state(false);
  let lastMarked = $state<RollEntry | null>(null);
  let undoTimer: ReturnType<typeof setTimeout> | undefined;
  let incident = $state<'idle' | 'sending' | 'sent' | 'queued'>('idle');
  let copied = $state(false);
  let installEvent = $state<(Event & { prompt: () => Promise<void> }) | null>(null);
  let waitingWorker = $state<ServiceWorker | null>(null);
  let standalone = $state(false);

  const list = $derived.by(() => {
    void app.revision;
    const folded = foldText(query.trim());
    return app.electors.filter(
      (entry) => app.voted(entry.id) === showVoted && (folded === '' || entry.search.includes(folded)),
    );
  });
  const remaining = $derived.by(() => {
    void app.revision;
    return app.electors.filter((entry) => !app.voted(entry.id)).length;
  });
  const digits = $derived(app.contact.replace(/\D/g, ''));
  const alertText = $derived(encodeURIComponent(t('urgent.message', { table: TABLE_ID })));

  onMount(() => {
    void app.start();
    standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      installEvent = event as Event & { prompt: () => Promise<void> };
    });
    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker.register(`${resolve('/')}service-worker.js`).then((registration) => {
        const watch = (worker: ServiceWorker | null) => {
          worker?.addEventListener('statechange', () => {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) waitingWorker = worker;
          });
        };
        if (registration.waiting && navigator.serviceWorker.controller) waitingWorker = registration.waiting;
        watch(registration.installing);
        registration.addEventListener('updatefound', () => watch(registration.installing));
      });
      let reloading = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (waitingWorker && !reloading) {
          reloading = true;
          location.reload();
        }
      });
    }
  });

  async function prepare() {
    preparing = true;
    prepareFailed = false;
    try {
      await app.prepare(size);
    } catch {
      prepareFailed = true;
    }
    preparing = false;
  }

  function mark(entry: RollEntry) {
    lastMarked = entry;
    clearTimeout(undoTimer);
    undoTimer = setTimeout(() => (lastMarked = null), 8_000);
    query = '';
    void app.mark(entry.id);
  }

  function undoLast() {
    if (lastMarked) void app.undo(lastMarked.id);
    lastMarked = null;
  }

  async function report() {
    incident = 'sending';
    incident = (await app.reportIncident()) ? 'sent' : 'queued';
  }

  async function copyReport() {
    await navigator.clipboard.writeText(await app.report());
    copied = true;
    setTimeout(() => (copied = false), 3_000);
  }

  function reset() {
    if (confirm(t('table.resetConfirm'))) void app.reset();
  }

  const yesNo = (value: boolean | null) => (value === null ? t('check.unknown') : value ? t('check.yes') : t('check.no'));
  const ms = (value: number | null) => (value === null ? t('check.unknown') : `${value.toFixed(0)} ms`);
  const when = (value: string | null | undefined) => (value ? new Date(value).toLocaleString(i18n.language) : t('check.unknown'));
</script>

<div class="shell">
  <header>
    <div class="top">
      <strong>Urna Abierta</strong>
      <label class="language">
        <span class="sr">{t('language')}</span>
        <select value={i18n.language} onchange={(event) => (i18n.language = event.currentTarget.value as Language)}>
          {#each Object.entries(LANGUAGES) as [code, name]}
            <option value={code}>{name}</option>
          {/each}
        </select>
      </label>
    </div>
    <div class="status" class:ok={app.pendingCount === 0} data-testid="sync-status">
      {#if app.pendingCount === 0}
        {t('sync.done')}
      {:else if app.sending && app.online}
        {t('sync.sending')}
      {:else}
        {t('sync.pending', { count: app.pendingCount })} · {t('sync.later')}
      {/if}
    </div>
    <div class="banner">{t('test.banner')}</div>
  </header>

  {#if waitingWorker}
    <div class="update">
      {#if app.pendingCount === 0}
        {t('update.available')}
        <button onclick={() => waitingWorker?.postMessage('update-now')}>{t('update.apply')}</button>
      {:else}
        {t('update.waiting')}
      {/if}
    </div>
  {/if}

  <main>
    {#if !app.ready}
      <p class="center">…</p>
    {:else if view === 'table'}
      {#if app.electors.length === 0}
        <section class="panel">
          <h1>{t('prepare.title')}</h1>
          <p>{t('prepare.text')}</p>
          <label for="size">{t('prepare.size')}</label>
          <select id="size" bind:value={size}>
            {#each SIZES as option}<option value={option}>{option}</option>{/each}
          </select>
          <button class="primary" onclick={prepare} disabled={preparing}>
            {preparing ? t('prepare.working') : t('prepare.button')}
          </button>
          {#if prepareFailed}<p class="error" role="alert">{t('prepare.failed')}</p>{/if}
        </section>
      {:else}
        <div class="summary">
          <span class="count" data-testid="remaining">{t('table.remaining', { remaining, total: app.electors.length })}</span>
          <input type="search" bind:value={query} placeholder={t('table.search')} aria-label={t('table.search')} />
          <button class="link" onclick={() => (showVoted = !showVoted)}>
            {showVoted ? t('table.showPending') : t('table.showVoted')}
          </button>
        </div>
        {#if list.length === 0}
          <p class="center">{t('table.empty')}</p>
        {:else}
          <VirtualList items={list} rowHeight={76}>
            {#snippet row(entry: RollEntry)}
              {#if showVoted}
                <button class="person voted" onclick={() => void app.undo(entry.id)}>
                  <span class="order">{entry.order}</span>
                  <span class="name">{entry.name}</span>
                  <span class="action">{t('table.undo')}</span>
                </button>
              {:else}
                <button class="person" data-testid="person" onclick={() => mark(entry)}>
                  <span class="order">{entry.order}</span>
                  <span class="name">{entry.name}</span>
                  <span class="suffix">…{entry.documentSuffix}</span>
                </button>
              {/if}
            {/snippet}
          </VirtualList>
        {/if}
        {#if lastMarked}
          <div class="snackbar" role="status">
            <span>{t('table.marked', { name: lastMarked.name })}</span>
            <button onclick={undoLast}>{t('table.undo')}</button>
          </div>
        {/if}
      {/if}
    {:else if view === 'urgent'}
      <section class="panel">
        <h1>{t('urgent.title')}</h1>
        <p>{t('urgent.text')}</p>
        <button class="danger" onclick={report} disabled={incident === 'sending'} data-testid="report">{t('urgent.button')}</button>
        {#if incident === 'sent'}
          <p class="success" role="status">{t('urgent.sent')}</p>
        {:else if incident === 'queued'}
          <p role="alert">{t('urgent.notSent')}</p>
          <a class="action-link" href="tel:{app.contact}">{t('urgent.call')}</a>
          <a class="action-link" href="https://wa.me/{digits}?text={alertText}">{t('urgent.whatsapp')}</a>
          <a class="action-link" href="sms:{app.contact}?&body={alertText}">{t('urgent.sms')}</a>
        {/if}
        <label for="contact">{t('urgent.contact')}</label>
        <input id="contact" type="tel" value={app.contact} onchange={(event) => app.saveContact(event.currentTarget.value)} />
      </section>
    {:else}
      <section class="panel scroll">
        <h1>{t('check.title')}</h1>
        {#if !standalone}
          {#if installEvent}
            <button class="primary" onclick={() => installEvent?.prompt()}>{t('check.install')}</button>
          {:else}
            <p>{t('check.installIos')}</p>
          {/if}
        {/if}
        <dl>
          <dt>{t('check.offline')}</dt><dd>{app.online ? t('check.online') : t('check.noSignal')}</dd>
          <dt>{t('check.installed')}</dt><dd>{yesNo(standalone)}</dd>
          <dt>{t('check.persisted')}</dt><dd>{yesNo(app.persisted)}</dd>
          <dt>{t('check.intact')}</dt><dd data-testid="intact">{yesNo(app.intact)}</dd>
          <dt>{t('check.people')}</dt><dd>{app.electors.length}</dd>
          <dt>{t('check.first')}</dt><dd>{when(app.canary?.firstOpen)}</dd>
          <dt>{t('check.previous')}</dt><dd>{when(app.canary?.previousOpen)}</dd>
          <dt>{t('check.opens')}</dt><dd>{app.canary?.opens ?? 0}</dd>
          <dt>{t('check.gap')}</dt><dd>{t('check.days', { days: (app.canary?.longestGapDays ?? 0).toFixed(1) })}</dd>
          <dt>{t('check.tap')}</dt><dd>{ms(app.tapStats().median)} / {ms(app.tapStats().worst)}</dd>
          <dt>{t('check.write')}</dt><dd>{ms(app.writeStats().median)} / {ms(app.writeStats().worst)}</dd>
        </dl>
        <button class="primary" onclick={copyReport}>{copied ? t('check.copied') : t('check.copy')}</button>
        <p class="note">{t('check.note')}</p>
        {#if app.electors.length > 0}
          <button class="link" onclick={reset}>{t('table.reset')}</button>
        {/if}
      </section>
    {/if}
  </main>

  <nav>
    <button class:active={view === 'table'} onclick={() => (view = 'table')}>{t('nav.table')}</button>
    <button class:active={view === 'urgent'} class="urgent" onclick={() => (view = 'urgent')}>{t('nav.urgent')}</button>
    <button class:active={view === 'check'} onclick={() => (view = 'check')}>{t('nav.check')}</button>
  </nav>
</div>

<style>
  :global(html, body) {
    margin: 0;
    height: 100%;
    font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    font-size: 18px;
    color: #111;
    background: #fff;
    overscroll-behavior: none;
  }
  :global(*) { box-sizing: border-box; }
  button, input, select { font: inherit; }
  .shell { display: flex; flex-direction: column; height: 100dvh; }
  header { background: #143a5a; color: #fff; padding: 8px 12px 0; padding-top: max(8px, env(safe-area-inset-top)); }
  .top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .language select { padding: 4px 6px; border-radius: 6px; border: 0; }
  .status { padding: 4px 0; font-weight: 600; color: #ffd98a; }
  .status.ok { color: #b9f3c4; }
  .banner { margin: 0 -12px; padding: 2px 12px; background: #fff3cd; color: #5c4400; font-size: 14px; }
  .update { padding: 8px 12px; background: #e7f1fb; display: flex; align-items: center; gap: 8px; justify-content: space-between; }
  main { flex: 1; min-height: 0; display: flex; flex-direction: column; position: relative; }
  .panel { padding: 16px; display: flex; flex-direction: column; gap: 12px; }
  .scroll { overflow-y: auto; }
  h1 { margin: 0; font-size: 24px; }
  label { font-weight: 600; }
  .panel select, .panel input { min-height: 52px; padding: 8px; border: 2px solid #777; border-radius: 8px; width: 100%; }
  .primary, .danger, .action-link { min-height: 60px; border: 0; border-radius: 10px; font-weight: 700; font-size: 20px; color: #fff; display: flex; align-items: center; justify-content: center; text-decoration: none; }
  .primary { background: #143a5a; }
  .danger { background: #b3261e; min-height: 88px; }
  .action-link { background: #0b6e4f; }
  .error { color: #b3261e; font-weight: 600; }
  .success { color: #0b6e4f; font-weight: 700; }
  .center { text-align: center; padding: 24px; }
  .summary { padding: 8px 12px; display: flex; flex-direction: column; gap: 6px; border-bottom: 1px solid #ccc; }
  .count { font-size: 24px; font-weight: 800; }
  .summary input { min-height: 48px; padding: 6px 10px; border: 2px solid #777; border-radius: 8px; width: 100%; }
  .link { background: none; border: 0; color: #0b4f8a; text-decoration: underline; padding: 6px 0; text-align: left; }
  .person { width: 100%; height: 72px; display: flex; align-items: center; gap: 10px; padding: 0 12px; background: #fff; border: 0; border-bottom: 1px solid #ddd; text-align: left; color: inherit; }
  .person:active { background: #dff3e4; }
  .order { font-weight: 800; font-size: 20px; min-width: 52px; }
  .name { flex: 1; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; line-height: 1.2; }
  .suffix { color: #555; font-size: 15px; }
  .voted .name { text-decoration: line-through; color: #555; }
  .action { color: #0b4f8a; font-weight: 600; }
  .snackbar { position: absolute; left: 8px; right: 8px; bottom: 8px; background: #222; color: #fff; padding: 10px 12px; border-radius: 10px; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .snackbar button { background: none; border: 0; color: #ffd98a; font-weight: 700; padding: 10px; }
  nav { display: flex; border-top: 1px solid #bbb; padding-bottom: env(safe-area-inset-bottom); }
  nav button { flex: 1; min-height: 60px; border: 0; background: #f1f1f1; font-weight: 600; color: #111; }
  nav button.active { background: #143a5a; color: #fff; }
  nav .urgent { color: #b3261e; }
  nav .urgent.active { background: #b3261e; color: #fff; }
  dl { display: grid; grid-template-columns: 1fr auto; gap: 6px 12px; margin: 0; }
  dt { color: #333; }
  dd { margin: 0; font-weight: 600; text-align: right; }
  .note { font-size: 15px; color: #444; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
</style>
