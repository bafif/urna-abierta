<script lang="ts">
  import { onDestroy } from 'svelte';
  import Ic from '../components/Ic.svelte';
  import Pantalla from '../components/Pantalla.svelte';
  import { t } from '../i18n.svelte.ts';
  import { nav } from '../nav.svelte.ts';
  import { ui } from '../ui.svelte.ts';

  /** The first time it opens there is nowhere to go back to: choosing leads into the app. */
  let { first = false, onchosen }: { first?: boolean; onchosen?: () => void } = $props();

  ui.startTrying();
  onDestroy(() => ui.cancelTrying());

  const position = $derived(ui.all.findIndex((theme) => theme.id === ui.theme.id));
  const SAMPLE = [
    { order: 24, name: 'Acuña, Martín', doc: '066', marked: true },
    { order: 25, name: 'Aguirre, Paula', doc: '406', marked: true },
    { order: 26, name: 'Álvarez, Inés', doc: '812', marked: false },
  ];

  function another() {
    ui.tryTheme(ui.all[(position + 1) % ui.all.length]!.id);
  }

  function use() {
    ui.keep();
    if (onchosen) onchosen();
    else nav.back();
  }
</script>

<Pantalla volver={!first} titulo={t('theme.title')} bajada={t('theme.subtitle')}>
  <p class="nombre-tema">{ui.theme.nombre}<small>{t('theme.position', { n: position + 1, total: ui.all.length })}</small></p>
  <div class="muestra-lista lista" aria-hidden="true">
    {#each SAMPLE as person}
      <div class="fila" class:tachada={person.marked}>
        <span class="num">{person.order}</span>
        <span class="nombre"><span class="nombre-t">{person.name}</span></span>
        <span class="doc">…{person.doc}</span>
      </div>
    {/each}
  </div>
  <div class="modos">
    <button class="modo" aria-pressed={ui.mode === 'claro'} onclick={() => ui.tryMode('claro')}>{t('theme.light')}</button>
    <button class="modo" aria-pressed={ui.mode === 'oscuro'} onclick={() => ui.tryMode('oscuro')}>{t('theme.dark')}</button>
  </div>
  {#snippet pie()}
    <div class="pila">
      <button class="boton primario" onclick={use}><Ic name="tilde" /><span>{t('theme.use')}</span></button>
      <button class="boton secundario" onclick={another}><Ic name="flecha" /><span>{t('theme.another')}</span></button>
    </div>
  {/snippet}
</Pantalla>
