<script lang="ts">
  import Ic from '../components/Ic.svelte';
  import Keypad from '../components/Keypad.svelte';
  import Pantalla from '../components/Pantalla.svelte';
  import { app } from '../app.svelte.ts';
  import { t } from '../i18n.svelte.ts';
  import { nav } from '../nav.svelte.ts';

  let typed = $state('');
  let failed = $state(false);

  const count = $derived(typed === '' ? null : Number(typed));
  const marked = $derived(app.markedCount);

  async function save() {
    if (count === null) return;
    failed = !(await app.countEnvelopes(app.today, count));
    if (!failed) nav.back();
  }
</script>

<Pantalla accion="sobres" volver titulo={t('envelopes.title')} bajada={t('envelopes.text')}>
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
    <button class="boton primario" disabled={count === null} onclick={save}><Ic name="tilde" /><span>{t('save')}</span></button>
  {/snippet}
</Pantalla>
