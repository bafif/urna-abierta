<script lang="ts">
  import { onMount } from 'svelte';
  import Ic from '../components/Ic.svelte';
  import Pantalla from '../components/Pantalla.svelte';
  import { t } from '../i18n.svelte.ts';
  import { nav } from '../nav.svelte.ts';
  import { inviteLink, session } from '../session.svelte.ts';

  interface Table {
    id: string;
    name: string;
    fiscal: { id: string; name: string } | null;
  }
  interface Pending {
    name: string;
    phone: string | null;
    table: string;
    invitation: string;
  }

  let { election }: { election: string } = $props();
  let tables = $state.raw<Table[]>([]);
  let pending = $state.raw<Pending[] | null>(null);
  let loaded = $state(false);
  let copied = $state(false);

  onMount(async () => {
    tables = (await session.api<{ tables: Table[] }>(`/elections/${election}/tables`)).tables;
    loaded = true;
  });

  const missing = $derived(tables.filter((table) => !table.fiscal));

  async function inviteAll() {
    pending = (await session.api<{ invitations: Pending[] }>(`/elections/${election}/invitations`, { method: 'POST' })).invitations;
  }

  /** A sheet to copy into a group or a spreadsheet: one line per person with their own link. */
  async function copyAll() {
    await navigator.clipboard.writeText((pending ?? []).map((item) => `${item.table}: ${item.name}: ${inviteLink(item.invitation)}`).join('\n'));
    copied = true;
    setTimeout(() => (copied = false), 3_000);
  }

  const whatsapp = (item: Pending) => `https://wa.me/${item.phone?.replace(/\D/g, '')}?text=${encodeURIComponent(t('invite.message', { name: item.name.split(' ')[0] ?? '', party: session.me?.party.name ?? '', link: inviteLink(item.invitation) }))}`;
</script>

{#if pending}
  <Pantalla accion="equipo" volver onback={() => (pending = null)} titulo={pending.length ? t('fiscales.links', { count: pending.length }) : t('fiscales.allJoined')} bajada={pending.length ? t('fiscales.links.text') : ''} desliza>
    <div class="tarjetas">
      {#each pending as item (item.invitation)}
        <div class="tarjeta" data-testid="pending-invite">
          <strong>{item.name}</strong>
          <span>{item.table}</span>
          {#if item.phone}<a class="enlace" href={whatsapp(item)}>{t('invite.whatsapp')}</a>{/if}
        </div>
      {/each}
    </div>
    {#snippet pie()}
      {#if pending?.length}<button class="boton secundario" onclick={copyAll}>{copied ? t('invite.copied') : t('fiscales.copyAll')}</button>{/if}
    {/snippet}
  </Pantalla>
{:else}
  <Pantalla accion="equipo" volver ojo={t('fiscales.eyebrow')} titulo={!loaded ? '' : missing.length ? t('fiscales.missing', { count: missing.length }) : t('fiscales.complete')} desliza>
    <div class="tarjetas compactas">
      {#each missing as table (table.id)}
        <button class="tarjeta falta" data-testid="table-missing" onclick={() => nav.go('addPerson', { role: 'fiscal', table: table.id, label: t('fiscales.who', { table: table.name }) })}>
          <strong>{table.name}</strong><span>{t('fiscales.none')}</span>
        </button>
      {/each}
      {#each tables.filter((table) => table.fiscal) as table (table.id)}
        <div class="tarjeta fila-mesa"><strong>{table.name}</strong><span>{table.fiscal?.name}</span></div>
      {/each}
    </div>
    {#snippet pie()}
      <button class="boton primario" disabled={tables.length === missing.length} onclick={inviteAll}><Ic name="sobre" /><span>{t('fiscales.inviteAll')}</span></button>
    {/snippet}
  </Pantalla>
{/if}
