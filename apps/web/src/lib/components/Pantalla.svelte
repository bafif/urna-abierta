<script lang="ts">
  import type { Snippet } from 'svelte';
  import { t } from '../i18n.svelte.ts';
  import { nav } from '../nav.svelte.ts';
  import { ui } from '../ui.svelte.ts';
  import Ic from './Ic.svelte';
  import Notices from './Notices.svelte';

  interface Props {
    /** The kind of task, which some themes tell apart by color. */
    accion?: string;
    volver?: boolean;
    onback?: () => void;
    ojo?: string;
    titulo?: string;
    bajada?: string;
    encabezado?: Snippet;
    children?: Snippet;
    pie?: Snippet;
    /** For screens whose content can be longer than the phone. */
    desliza?: boolean;
  }

  let { accion = 'plan', volver = false, onback, ojo, titulo = '', bajada, encabezado, children, pie, desliza = false }: Props = $props();

  const style = $derived(window.URNA_TEMA.variables(ui.theme, ui.mode, accion));
  const recipes = $derived(window.URNA_TEMA.recetas(ui.theme));

  $effect(() => {
    const color = ui.theme[ui.mode].fondo!;
    document.documentElement.style.background = color;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color);
  });
</script>

<div class="pantalla" {style} {...recipes}>
  <div class="pantalla-in" data-accion={accion}>
    <header class="cabeza">
      {#if volver}
        <button class="atras" onclick={() => (onback ? onback() : nav.back())}><Ic name="atras" /><span>{t('back')}</span></button>
      {/if}
      {#if ui.theme.logo}<div class="logo-tema"><img src={ui.theme.logo} alt={ui.theme.nombre} /></div>{/if}
      {#if ojo}<p class="ojo">{ojo}</p>{/if}
      <h1 class="t1">
        {#if encabezado}{@render encabezado()}{:else}{titulo}{/if}
      </h1>
      {#if bajada}<p class="bajada">{bajada}</p>{/if}
    </header>
    <Notices />
    <main class="cuerpo" class:desliza>{@render children?.()}</main>
    {#if pie}<footer class="pie">{@render pie()}</footer>{/if}
  </div>
</div>
