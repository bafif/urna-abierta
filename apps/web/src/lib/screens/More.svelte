<script lang="ts">
  import Pantalla from '../components/Pantalla.svelte';
  import { t } from '../i18n.svelte.ts';
  import { nav } from '../nav.svelte.ts';
  import { session } from '../session.svelte.ts';

  /** As the first screen, for whoever only looks after the system: it is what they can do. */
  let { inicio = false }: { inicio?: boolean } = $props();

  const items = $derived(
    [
      { screen: 'party', title: t('more.party'), detail: t('more.party.detail'), show: session.allows('election.manage') },
      { screen: 'team', title: t('more.team'), detail: t('more.team.detail'), show: session.allows('users.manage') },
      { screen: 'permissions', title: t('permissions.title'), detail: t('more.permissions.detail'), show: session.allows('users.manage') },
      { screen: 'security', title: t('more.security'), detail: t('more.security.detail'), show: session.allows('security.manage') },
      { screen: 'backups', title: t('more.backups'), detail: t('more.backups.detail'), show: session.allows('security.manage') },
      { screen: 'lightCategories', title: t('more.light'), detail: t('more.light.detail'), show: session.allows('election.manage') },
      { screen: 'persons', title: t('more.persons'), detail: t('more.persons.detail'), show: session.allows('persons.manage') },
      { screen: 'audit', title: t('more.audit'), detail: t('more.audit.detail'), show: session.allows('audit.read') },
      { screen: 'settings', title: t('plan.settings'), detail: t('more.settings.detail'), show: true },
    ].filter((item) => item.show),
  );
</script>

<Pantalla accion="partido" volver={!inicio} ojo={inicio ? session.me?.party.name : undefined} titulo={t('more.title')} desliza>
  <div class="tarjetas">
    {#each items as item (item.screen)}
      <button class="tarjeta" onclick={() => nav.go(item.screen)}><strong>{item.title}</strong><span>{item.detail}</span></button>
    {/each}
  </div>
</Pantalla>
