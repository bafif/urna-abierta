<script lang="ts">
  import Ic from '../components/Ic.svelte';
  import Keypad from '../components/Keypad.svelte';
  import Pantalla from '../components/Pantalla.svelte';
  import { app } from '../app.svelte.ts';
  import { untrack } from 'svelte';
  import { formatDayShort, t } from '../i18n.svelte.ts';
  import { nav } from '../nav.svelte.ts';
  import { session } from '../session.svelte.ts';

  /** The day whose count is being corrected, if this is a correction. */
  let { correcting }: { correcting?: string } = $props();

  // A correction starts from what was counted, and compares with what was crossed out that day.
  const before = untrack(() => (correcting ? app.envelopesOf(correcting) : null));
  let typed = $state(before ? String(before.envelopes) : '');
  let failed = $state(false);

  const count = $derived(typed === '' ? null : Number(typed));
  const marked = $derived(before ? before.marked : app.markedCount);
  const chief = $derived(session.me?.contact?.name.split(' ')[0] ?? '');

  async function save() {
    if (count === null) return;
    failed = !(await app.countEnvelopes(correcting ?? app.today, count, marked));
    if (failed) return;
    if (!correcting) return nav.back();
    app.noteCorrection();
    nav.home();
  }
</script>

<Pantalla
  accion="sobres"
  volver
  aviso
  ojo={correcting ? t('correct.of', { what: t('correct.envelopes', { day: formatDayShort(correcting) }) }) : undefined}
  titulo={t('envelopes.title')}
  bajada={before ? `${t('correct.before', { count: before.envelopes })} ${chief ? t('correct.tell', { name: chief }) : t('correct.tell.noName')}` : t('envelopes.text')}
>
  <Keypad bind:value={typed} />
  {#if count !== null}
    {#if count === marked}
      <p class="resultado bien" data-testid="envelopes-result"><Ic name="tilde" />{t('envelopes.match', { count: marked })}</p>
    {:else}
      <p class="resultado mal" data-testid="envelopes-result">{t('envelopes.differ', { marked, count })}</p>
    {/if}
  {/if}
  {#if failed}<p class="problema" role="alert">{t('save.failedShort')}</p>{/if}
  {#snippet pie()}
    <button class="boton primario" disabled={count === null} onclick={save}><Ic name="tilde" /><span>{correcting ? t('correct.save') : t('save')}</span></button>
  {/snippet}
</Pantalla>
