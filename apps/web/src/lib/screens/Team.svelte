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
  let open = $state<string | null>(null);

  const load = async () => {
    people = (await session.api<{ users: Person[] }>('/users')).users;
  };
  onMount(load);

  async function invite(person: Person) {
    const { invitation } = await session.api<{ invitation: string }>(`/users/${person.id}/invitation`, { method: 'POST' });
    nav.go('invite', { name: person.name, phone: person.phone, token: invitation });
  }

  async function remove(person: Person) {
    if (!confirm(t('team.removeConfirm', { name: person.name }))) return;
    await session.api(`/users/${person.id}`, { method: 'DELETE' });
    open = null;
    await load();
  }

  function finished() {
    localStorage.setItem('urna-abierta-equipo-despues', '1');
    nav.back();
  }
</script>

<Pantalla accion="equipo" volver titulo={t('team.title')} desliza>
  <div class="tarjetas">
    {#each people as person (person.id)}
      <button class="tarjeta persona persona-boton" data-testid="team-person" onclick={() => (open = open === person.id ? null : person.id)}>
        <strong>{person.name}</strong>
        <span>{person.roles.map((item) => roleName(item.role)).join(', ')}{person.joined ? '' : ` · ${t('team.notJoined')}`}</span>
      </button>
      {#if open === person.id && person.id !== session.me?.user.id}
        <div class="renglon-botones">
          <!-- Managing the team and inviting are two tasks: whoever only looks after the system does not invite. -->
          {#if session.allows('team.invite')}
            <button class="enlace" onclick={() => invite(person)}>{t('team.invite')}</button>
          {/if}
          <button class="enlace" onclick={() => remove(person)}>{t('team.remove')}</button>
        </div>
      {/if}
    {/each}
  </div>
  <button class="boton secundario" onclick={() => nav.go('addPerson')}><Ic name="mas" /><span>{t('team.add')}</span></button>
  {#snippet pie()}
    <button class="boton primario" onclick={finished}><Ic name="flecha" /><span>{t('next')}</span></button>
  {/snippet}
</Pantalla>
