<script lang="ts">
  import { onMount } from 'svelte';
  import Ic from '../components/Ic.svelte';
  import Pantalla from '../components/Pantalla.svelte';
  import { roleName, t } from '../i18n.svelte.ts';
  import { nav } from '../nav.svelte.ts';
  import { session } from '../session.svelte.ts';

  interface Person {
    id: string;
    name: string;
    phone: string | null;
    joined: boolean;
    roles: { role: string; table: string | null }[];
  }

  let people = $state.raw<Person[]>([]);

  onMount(async () => {
    people = (await session.api<{ users: Person[] }>('/users')).users;
  });

  function finished() {
    localStorage.setItem('urna-abierta-equipo-despues', '1');
    nav.back();
  }
</script>

<Pantalla accion="equipo" volver titulo={t('team.title')} desliza>
  <div class="tarjetas">
    {#each people as person (person.id)}
      <button class="tarjeta persona persona-boton" data-testid="team-person" onclick={() => nav.go('person', { id: person.id })}>
        <strong>{person.name}</strong>
        <span>{person.roles.map((item) => roleName(item.role)).join(', ')}{person.joined ? '' : ` · ${t('team.notJoined')}`}</span>
      </button>
    {/each}
  </div>
  <button class="boton secundario" onclick={() => nav.go('addPerson')}><Ic name="mas" /><span>{t('team.add')}</span></button>
  {#snippet pie()}
    <button class="boton primario" onclick={finished}><Ic name="flecha" /><span>{t('next')}</span></button>
  {/snippet}
</Pantalla>
