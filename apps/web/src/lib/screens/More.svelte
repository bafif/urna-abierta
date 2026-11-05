<script lang="ts">
  import Pantalla from '../components/Pantalla.svelte';
  import { t } from '../i18n.svelte.ts';
  import { nav } from '../nav.svelte.ts';
  import { session } from '../session.svelte.ts';

  const items = $derived(
    [
      { screen: 'party', title: t('more.party'), detail: t('more.party.detail'), show: session.can('coordinacion') },
      { screen: 'team', title: t('more.team'), detail: t('more.team.detail'), show: session.can('coordinacion', 'sistema') },
      { screen: 'permissions', title: t('permissions.title'), detail: t('more.permissions.detail'), show: session.can('coordinacion', 'sistema') },
      { screen: 'security', title: t('more.security'), detail: t('more.security.detail'), show: session.can('sistema') },
      { screen: 'backups', title: t('more.backups'), detail: t('more.backups.detail'), show: session.can('sistema') },
      { screen: 'lightCategories', title: t('more.light'), detail: t('more.light.detail'), show: session.can('coordinacion') },
      { screen: 'persons', title: t('more.persons'), detail: t('more.persons.detail'), show: session.can('coordinacion') },
      { screen: 'audit', title: t('more.audit'), detail: t('more.audit.detail'), show: session.can('coordinacion', 'sistema') },
      { screen: 'settings', title: t('plan.settings'), detail: t('more.settings.detail'), show: true },
    ].filter((item) => item.show),
  );
</script>

<Pantalla accion="partido" volver titulo={t('more.title')} desliza>
  <div class="tarjetas">
    {#each items as item (item.screen)}
      <button class="tarjeta" onclick={() => nav.go(item.screen)}><strong>{item.title}</strong><span>{item.detail}</span></button>
    {/each}
  </div>
</Pantalla>
