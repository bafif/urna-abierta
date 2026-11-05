<script lang="ts">
  import Ic from '../components/Ic.svelte';
  import Pantalla from '../components/Pantalla.svelte';
  import { t } from '../i18n.svelte.ts';
  import { nav } from '../nav.svelte.ts';
  import { ApiError, session } from '../session.svelte.ts';

  interface Summary {
    people: number;
    added: number;
    kept: number;
    missing: number;
    toReview: number;
    withoutTable: number;
  }

  let { election }: { election: string } = $props();

  let file = $state.raw<File | null>(null);
  let summary = $state.raw<Summary | null>(null);
  let problem = $state('');
  let working = $state(false);

  const typeOf = (picked: File) => (/\.(csv|txt)$/i.test(picked.name) ? 'text/csv' : 'application/zip');

  const send = (picked: File, preview: boolean) =>
    session.api<Summary>(`/elections/${election}/roll${preview ? '?preview=1' : ''}`, { method: 'POST', raw: picked, type: typeOf(picked) });

  async function read(event: Event & { currentTarget: HTMLInputElement }) {
    const picked = event.currentTarget.files?.[0];
    if (!picked) return;
    problem = '';
    summary = null;
    file = null;
    working = true;
    try {
      summary = await send(picked, true);
      file = picked;
    } catch (error) {
      problem = error instanceof ApiError && error.code === 'external_ai_forbidden' ? t('roll.upload.aiForbidden') : t('roll.upload.unreadable');
    }
    working = false;
  }

  async function load() {
    if (!file) return;
    working = true;
    try {
      await send(file, false);
      nav.back();
    } catch {
      problem = t('error.tryAgain');
    }
    working = false;
  }
</script>

<Pantalla accion="eleccion" volver ojo={t('roll.upload.eyebrow')} titulo={t('roll.upload.title')} bajada={t('roll.upload.text')} desliza>
  {#if summary}
    <div class="tarjeta leido" data-testid="roll-summary">
      <strong>{t('roll.upload.people', { count: summary.people })}</strong>
      {#if summary.kept > 0}<span>{t('roll.upload.changes', { added: summary.added, missing: summary.missing })}</span>{/if}
      {#if summary.toReview > 0}<span>{t('roll.upload.toReview', { count: summary.toReview })}</span>{/if}
    </div>
    {#if summary.missing > 0}<p class="resultado mal">{t('roll.upload.missing', { count: summary.missing })}</p>{/if}
  {/if}
  {#if problem}<p class="problema" role="alert">{problem}</p>{/if}
  <p class="aclara">{t('roll.upload.scanned')}</p>
  {#snippet pie()}
    <div class="pila">
      {#if summary}
        <button class="boton primario" disabled={working} onclick={load}><Ic name="tilde" /><span>{t('roll.upload.load')}</span></button>
      {/if}
      <label class={summary ? 'boton secundario' : 'boton primario'}>
        <input class="oculto" type="file" accept=".padron,.zip,.csv,.txt" data-testid="roll-file" onchange={read} disabled={working} />
        <span>{working ? t('roll.upload.reading') : summary ? t('roll.upload.another') : t('roll.upload.choose')}</span>
      </label>
    </div>
  {/snippet}
</Pantalla>
