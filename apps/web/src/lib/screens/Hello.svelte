<script lang="ts">
  import Ic from '../components/Ic.svelte';
  import Pantalla from '../components/Pantalla.svelte';
  import { i18n, t } from '../i18n.svelte.ts';
  import { session } from '../session.svelte.ts';

  let { onstart }: { onstart: () => void } = $props();

  const me = $derived(session.me!);
  const firstName = $derived(me.user.name.split(' ')[0] ?? '');
  const text = $derived.by(() => {
    if (me.table) return me.table.place ? t('hello.fiscalAt', { table: me.table.name, place: me.table.place }) : t('hello.fiscal', { table: me.table.name });
    return t(`hello.role.${me.main ?? 'none'}` as Parameters<typeof t>[0]);
  });
</script>

<Pantalla titulo={t('hello.title', { name: firstName })} bajada={text}>
  {#if me.contact}
    <div class="tarjeta dato"><span>{t('hello.doubts')}</span><strong>{me.contact.name}</strong></div>
  {/if}
  {#snippet pie()}
    <div class="pila">
      <button class="boton primario" onclick={onstart}><Ic name="flecha" /><span>{t('hello.start')}</span></button>
      <button class="enlace" onclick={() => (i18n.language = i18n.language === 'es' ? 'en' : 'es')}>{t('hello.otherLanguage')}</button>
    </div>
  {/snippet}
</Pantalla>
