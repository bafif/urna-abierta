<script lang="ts">
  import { onMount } from 'svelte';
  import Ic from '../components/Ic.svelte';
  import Pantalla from '../components/Pantalla.svelte';
  import Stations, { type Station } from '../components/Stations.svelte';
  import { formatRange, t } from '../i18n.svelte.ts';
  import { nav } from '../nav.svelte.ts';
  import { session } from '../session.svelte.ts';
  import type { ElectionSummary } from '../types.ts';

  const TEAM_SKIPPED = 'urna-abierta-equipo-despues';

  let elections = $state.raw<ElectionSummary[] | null>(null);
  let people = $state(0);
  let problem = $state(false);

  onMount(async () => {
    try {
      const [listed, team] = await Promise.all([
        session.api<{ elections: ElectionSummary[] }>('/elections'),
        session.allows('users.manage') ? session.api<{ users: unknown[] }>('/users') : { users: [] },
      ]);
      elections = listed.elections;
      people = team.users.length;
      await session.refresh();
    } catch {
      problem = true;
    }
  });

  const me = $derived(session.me!);
  const canSecurity = $derived(session.allows('security.manage'));
  const firstName = $derived(me.user.name.split(' ')[0] ?? '');
  const done = $derived({
    party: Boolean(me.party.name),
    team: people > 1 || localStorage.getItem(TEAM_SKIPPED) !== null,
    security: !canSecurity || me.security.chosen,
  });
  const next = $derived(!done.party ? 'party' : !done.team ? 'team' : !done.security ? 'security' : 'election');
  const stations = $derived.by((): Station[] => {
    const state = (key: keyof typeof done | 'election'): Station['state'] => (next === key ? 'ahora' : key !== 'election' && done[key] ? 'hecho' : '');
    const list: Station[] = [
      { text: t('admin.party'), when: done.party ? me.party.name : t('admin.party.when'), state: state('party'), help: t('admin.party.help') },
      { text: t('admin.team'), when: t('admin.team.when'), state: state('team'), help: t('admin.team.help') },
    ];
    if (canSecurity) list.push({ text: t('admin.security'), when: t('admin.security.when'), state: state('security'), help: t('admin.security.help') });
    list.push({ text: t('admin.election'), when: t('admin.election.when'), state: state('election'), help: t('admin.election.help') });
    return list;
  });

  function continueSetup() {
    if (next === 'election') nav.go('electionNew');
    else nav.go(next);
  }

  function statusOf(election: ElectionSummary): string {
    if (election.status === 'purgada') return t('elections.purged');
    if (election.status === 'cerrada') return t('elections.closed');
    if (election.status === 'jornada') return t('elections.running');
    if (election.status === 'escrutinio') return t('elections.counting');
    if (election.people === 0) return t('elections.missingRoll');
    if (election.without_table > 0) return t('elections.missingTables');
    if (election.tables_without_fiscal > 0) return t('elections.missingFiscales', { count: election.tables_without_fiscal });
    return t('elections.ready');
  }
</script>

{#if elections && elections.length > 0}
  <Pantalla accion="eleccion" ojo={me.party.name} titulo={t('elections.title')} desliza>
    <div class="tarjetas">
      {#each elections as election (election.id)}
        <button class="tarjeta eleccion" class:apagada={['cerrada', 'purgada'].includes(election.status)} data-testid="election" onclick={() => nav.go('election', { id: election.id })}>
          <strong>{election.name}</strong>
          <span>{formatRange(election.days)} · {statusOf(election)}</span>
        </button>
      {/each}
    </div>
    {#snippet pie()}
      <div class="pila">
        <button class="boton primario" onclick={() => nav.go('electionNew')}><Ic name="mas" /><span>{t('elections.new')}</span></button>
        <button class="enlace" onclick={() => nav.go('more')}>{t('elections.more')}</button>
      </div>
    {/snippet}
  </Pantalla>
{:else if elections}
  <Pantalla accion="partido" titulo={t('hello.title', { name: firstName })} bajada={t('admin.text')} desliza>
    <Stations steps={stations} />
    {#snippet pie()}
      <div class="pila">
        <button class="boton primario" onclick={continueSetup}><Ic name="flecha" /><span>{t(next === 'election' ? 'elections.new' : 'next')}</span></button>
        <button class="enlace" onclick={() => nav.go('settings')}>{t('plan.settings')}</button>
      </div>
    {/snippet}
  </Pantalla>
{:else}
  <Pantalla titulo={problem ? t('error.tryAgain') : ''} />
{/if}
