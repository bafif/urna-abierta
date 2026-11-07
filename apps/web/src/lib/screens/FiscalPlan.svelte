<script lang="ts">
  import Ic from '../components/Ic.svelte';
  import Pantalla from '../components/Pantalla.svelte';
  import Stations, { type Station } from '../components/Stations.svelte';
  import SyncLine from '../components/SyncLine.svelte';
  import { app } from '../app.svelte.ts';
  import { formatDay, t } from '../i18n.svelte.ts';
  import { nav } from '../nav.svelte.ts';
  import { pwa } from '../pwa.svelte.ts';
  import { session } from '../session.svelte.ts';

  let preparing = $state(false);
  let failed = $state(false);

  const table = $derived(app.table);
  const step = $derived(app.step);
  const days = $derived(table?.shift ?? table?.days ?? []);
  const multiDay = $derived(days.length > 1);
  const pending = $derived(app.pendingCount + app.pendingPhotos);
  const chief = $derived(session.me?.contact?.name.split(' ')[0] ?? '');
  // What was entered can be corrected from the first envelope count until the election closes.
  const canCorrect = $derived(app.countedDays.size > 0);
  const rollToo = $derived(step === 'tally' || step === 'photo' || step === 'done');

  const stations = $derived.by((): Station[] => {
    const order = ['prepare', 'mark', 'count', 'tally'];
    const now = { prepare: 0, waiting: 1, mark: 1, rest: 2, tally: 3, photo: 3, done: 4 }[step];
    const state = (index: number): Station['state'] => {
      if (step === 'waiting' && index === 1) return '';
      if (step === 'rest' && index === 2) return 'hecho';
      return index < now ? 'hecho' : index === now ? 'ahora' : '';
    };
    const when = {
      prepare: t('plan.prepare.when'),
      mark: multiDay ? t('plan.mark.whenDays', { n: days.length }) : t('plan.mark.when'),
      count: multiDay ? t('plan.count.whenDays') : t('plan.count.when'),
      tally: multiDay ? t('plan.tally.whenDays') : t('plan.tally.when'),
    };
    const help = {
      prepare: t('plan.prepare.help'),
      mark: t('plan.mark.help'),
      count: '',
      tally: step === 'photo' ? t('plan.photo.help') : t('plan.tally.help'),
    };
    const text = { prepare: t('plan.prepare'), mark: t('plan.mark'), count: t('plan.count'), tally: t('plan.tally') };
    return order.map((key, index) => ({
      text: text[key as keyof typeof text],
      when: index < now || state(index) === 'hecho' ? t('plan.done') : when[key as keyof typeof when],
      state: state(index),
      help: help[key as keyof typeof help],
    }));
  });

  const title = $derived.by(() => {
    if (step === 'rest') return t('plan.rest.title');
    if (step === 'done') return t('plan.finished.title');
    return t('plan.title');
  });
  const subtitle = $derived.by(() => {
    // Whoever starts on a later day is told about their own first day, not about the election's.
    if (step === 'waiting') return days[0]! > (table?.days[0] ?? '') ? t('plan.waiting.shift', { day: formatDay(days[0]!) }) : t('plan.waiting', { day: formatDay(days[0]!) });
    if (step === 'rest') {
      const next = days.find((day) => day > app.today);
      return next ? t('plan.rest.next', { day: formatDay(next) }) : '';
    }
    if (step === 'done') return pending > 0 ? t('plan.finished.pending') : app.arrivedLate ? t('plan.finished.late') : t('plan.finished.sent');
    return '';
  });

  async function prepare() {
    if (pwa.iphone && !pwa.installed && !app.practice && !sessionStorage.getItem('urna-abierta-sin-instalar')) {
      nav.go('installIphone');
      return;
    }
    preparing = true;
    failed = false;
    try {
      await app.prepare();
    } catch {
      failed = true;
    }
    preparing = false;
  }
</script>

{#if !app.ready}
  <Pantalla />
{:else if !table && session.me?.ended}
  <!-- What is still on the phone goes out after the close too, so the person is told to wait for it. -->
  <Pantalla titulo={t('plan.ended.title')} bajada={pending > 0 ? t('plan.finished.pending') : t('plan.ended.text')}>
    {#if pending > 0}<SyncLine />{/if}
    {#snippet pie()}
      <div class="pila">
        <!-- Someone who worked an earlier election may be waiting for a table in the next one. -->
        <button class="boton secundario" onclick={() => session.refresh()}>{t('plan.noTable.check')}</button>
        <button class="enlace" onclick={() => nav.go('settings')}>{t('plan.settings')}</button>
      </div>
    {/snippet}
  </Pantalla>
{:else if !table}
  <Pantalla titulo={t('plan.noTable.title')} bajada={t('plan.noTable.text')}>
    {#snippet pie()}
      <div class="pila">
        <button class="boton primario" onclick={() => session.refresh()}>{t('plan.noTable.check')}</button>
        <button class="enlace" onclick={() => nav.go('settings')}>{t('plan.settings')}</button>
      </div>
    {/snippet}
  </Pantalla>
{:else}
  <Pantalla ojo={formatDay(app.today)} titulo={title} bajada={subtitle} desliza>
    <Stations steps={stations} />
    {#if app.correctionSaved}
      <p class="resultado bien" role="status" data-testid="correction-saved"><Ic name="tilde" />{chief ? t('correct.saved', { name: chief }) : t('correct.saved.noName')}</p>
    {/if}
    {#if canCorrect && step === 'done'}
      <div class="aviso-suave">
        <span>{t('correct.hint')}</span>
        <button class="enlace" onclick={() => nav.go('correct')}>{t('correct.link')}</button>
      </div>
    {:else if canCorrect}
      <button class="enlace" onclick={() => nav.go('correct')}>{t('correct.link')}</button>
    {/if}
    {#if failed}<p class="problema" role="alert">{t('prepare.failed')}</p>{/if}
    {#if step === 'photo' && app.photoRefused}<p class="problema" role="alert">{t('photo.refused')}</p>{/if}
    {#if pwa.installEvent && !app.practice}
      <div class="aviso-suave">
        <span>{t('plan.install')}</span>
        <button class="enlace" onclick={() => pwa.install()}>{t('plan.install.button')}</button>
      </div>
    {/if}
    <SyncLine />
    {#snippet pie()}
      <div class="pila">
        {#if step === 'prepare'}
          <button class="boton primario" disabled={preparing} onclick={prepare}><Ic name="flecha" /><span>{preparing ? t('prepare.working') : t('plan.prepare')}</span></button>
        {:else if step === 'waiting'}
          <button class="boton primario" onclick={() => app.startPractice()}><Ic name="flecha" /><span>{t('plan.practice')}</span></button>
          <button class="enlace" onclick={() => nav.go('roll')}>{t('plan.openAnyway')}</button>
        {:else if step === 'mark'}
          <button class="boton primario" onclick={() => nav.go('roll')}><Ic name="flecha" /><span>{t('plan.openRoll')}</span></button>
          <button class="enlace" onclick={() => nav.go('envelopes')}>{t('plan.closed')}</button>
        {:else if step === 'rest'}
          <button class="boton secundario" onclick={() => nav.go('roll')}><span>{t('plan.openRoll')}</span></button>
        {:else if step === 'tally'}
          <button class="boton primario" onclick={() => nav.go('tally')}><Ic name="flecha" /><span>{t('plan.startTally')}</span></button>
        {:else if step === 'photo'}
          <button class="boton primario" onclick={() => nav.go('photo')}><Ic name="camara" /><span>{t('plan.takePhoto')}</span></button>
        {/if}
        <!-- Something can go wrong at any step, also after the count: the record is signed afterwards. -->
        {#if step !== 'prepare'}
          <button class="boton discreto-peligro" onclick={() => nav.go('alert')}><Ic name="aviso" /><span>{t('roll.problem')}</span></button>
        {/if}
        {#if rollToo}
          <div class="renglon-enlaces">
            <button class="enlace" onclick={() => nav.go('roll')}>{t('plan.openRoll')}</button>
            <button class="enlace" onclick={() => nav.go('settings')}>{t('plan.settings')}</button>
          </div>
        {:else}
          <button class="enlace" onclick={() => nav.go('settings')}>{t('plan.settings')}</button>
        {/if}
      </div>
    {/snippet}
  </Pantalla>
{/if}
