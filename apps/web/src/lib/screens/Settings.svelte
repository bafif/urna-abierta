<script lang="ts">
  import Pantalla from '../components/Pantalla.svelte';
  import { app } from '../app.svelte.ts';
  import { i18n, LANGUAGES, t, type Language } from '../i18n.svelte.ts';
  import { nav } from '../nav.svelte.ts';
  import { pwa } from '../pwa.svelte.ts';
  import { ApiError, session } from '../session.svelte.ts';

  let copied = $state(false);
  let themeMessage = $state('');

  const yesNo = (value: boolean | null) => (value === null ? t('settings.unknown') : value ? t('settings.yes') : t('settings.no'));
  const ms = (value: number | null) => (value === null ? t('settings.unknown') : `${value.toFixed(0)} ms`);
  const when = (value: string | null | undefined) => (value ? new Date(value).toLocaleString(i18n.language) : t('settings.unknown'));

  /** Other work this person also has, besides the one that opens first. */
  const tasks = $derived(
    [
      { role: 'fiscal', screen: 'fiscalPlan', title: t('task.fiscal') },
      { role: 'jefe', screen: 'district', title: t('task.jefe') },
      { role: 'coordinacion', screen: 'adminHome', title: t('task.admin') },
      { role: 'semaforo', screen: 'lightHome', title: t('task.light') },
      { role: 'estadistico', screen: 'numbers', title: t('task.numbers') },
    ].filter((task) => session.can(task.role) && task.role !== session.me?.main),
  );

  async function copyReport() {
    await navigator.clipboard.writeText(await app.report());
    copied = true;
    setTimeout(() => (copied = false), 3_000);
  }

  async function addTheme(event: Event & { currentTarget: HTMLInputElement }) {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    themeMessage = '';
    try {
      await session.api('/themes', { method: 'PUT', body: { theme: JSON.parse(await file.text()) } });
      await session.refresh();
      themeMessage = t('settings.theme.added');
    } catch (error) {
      themeMessage = error instanceof ApiError && error.problems.length > 0 ? `${t('settings.theme.refused')} ${error.problems[0]}` : t('settings.theme.refused');
    }
  }
</script>

<Pantalla volver titulo={t('plan.settings')} desliza>
  <button class="boton secundario" onclick={() => nav.go('chooseTheme')}>{t('settings.look')}</button>
  <div class="modos" role="group" aria-label={t('settings.language')}>
    {#each Object.entries(LANGUAGES) as [code, name]}
      <button class="modo" aria-pressed={i18n.language === code} onclick={() => (i18n.language = code as Language)}>{name}</button>
    {/each}
  </div>
  {#if !pwa.installed}
    {#if pwa.installEvent}
      <button class="boton secundario" onclick={() => pwa.install()}>{t('plan.install.button')}</button>
    {:else if pwa.iphone}
      <button class="boton secundario" onclick={() => nav.go('installIphone')}>{t('settings.installIphone')}</button>
    {/if}
  {/if}
  {#each tasks as task (task.role)}
    <button class="boton secundario" onclick={() => nav.go(task.screen)}>{task.title}</button>
  {/each}
  {#if session.can('fiscal') && !app.practice}
    <button class="enlace" onclick={() => app.startPractice()}>{t('plan.practice')}</button>
  {/if}
  {#if session.can('coordinacion')}
    <label class="enlace">
      <input class="oculto" type="file" accept=".json,application/json" onchange={addTheme} data-testid="theme-file" />
      {t('settings.theme.add')}
    </label>
    {#if themeMessage}<p class="aclara" role="status">{themeMessage}</p>{/if}
  {/if}
  {#if app.ready}
    <p class="etiqueta">{t('settings.state')}</p>
    <dl class="tabla-datos">
      <dt>{t('settings.connection')}</dt><dd>{app.online ? t('settings.online') : t('settings.noSignal')}</dd>
      <dt>{t('settings.installed')}</dt><dd>{yesNo(pwa.installed)}</dd>
      <dt>{t('settings.protected')}</dt><dd>{yesNo(app.persisted)}</dd>
      <dt>{t('settings.intact')}</dt><dd data-testid="intact">{yesNo(app.intact)}</dd>
      <dt>{t('settings.people')}</dt><dd>{app.electors.length}</dd>
      <dt>{t('settings.first')}</dt><dd>{when(app.canary?.firstOpen)}</dd>
      <dt>{t('settings.previous')}</dt><dd>{when(app.canary?.previousOpen)}</dd>
      <dt>{t('settings.opens')}</dt><dd>{app.canary?.opens ?? 0}</dd>
      <dt>{t('settings.gap')}</dt><dd>{t('settings.days', { days: (app.canary?.longestGapDays ?? 0).toFixed(1) })}</dd>
      <dt>{t('settings.tap')}</dt><dd>{ms(app.tapStats().median)} / {ms(app.tapStats().worst)}</dd>
      <dt>{t('settings.write')}</dt><dd>{ms(app.writeStats().median)} / {ms(app.writeStats().worst)}</dd>
    </dl>
    <button class="enlace" onclick={copyReport}>{copied ? t('settings.copied') : t('settings.copy')}</button>
    <p class="aclara">{t('settings.note')}</p>
  {/if}
</Pantalla>
