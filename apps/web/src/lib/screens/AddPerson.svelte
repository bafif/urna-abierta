<script lang="ts">
  import Ic from '../components/Ic.svelte';
  import Options from '../components/Options.svelte';
  import Pantalla from '../components/Pantalla.svelte';
  import { formatDay, t } from '../i18n.svelte.ts';
  import { nav } from '../nav.svelte.ts';
  import { session } from '../session.svelte.ts';

  /** Coming from a table or a district, what the person will do is already decided. */
  let { role: fixedRole, table, unit, label, electionDays = [], freeDays = [] }: { role?: string; table?: string; unit?: string; label?: string; electionDays?: string[]; freeDays?: string[] } = $props();

  let name = $state('');
  let phone = $state('');
  let chosenRole = $state<string | null>(null);
  const role = $derived(fixedRole ?? chosenRole);
  // Offers the days that nobody covers yet, all of them chosen: the usual case is one person for the rest.
  let shift = $state<string[]>([]);
  $effect.pre(() => {
    shift = [...freeDays];
  });
  const toggleDay = (day: string) => {
    shift = shift.includes(day) ? shift.filter((item) => item !== day) : [...shift, day].sort();
  };
  let advanced = $state(false);
  let failed = $state(false);

  const options = $derived([
    { id: 'fiscal', title: t('role.fiscal.title'), detail: t('role.fiscal.detail') },
    { id: 'jefe', title: t('role.jefe.title'), detail: t('role.jefe.detail') },
    { id: 'semaforo', title: t('role.semaforo.title'), detail: t('role.semaforo.detail') },
    { id: 'estadistico', title: t('role.estadistico.title'), detail: t('role.estadistico.detail') },
    ...(advanced
      ? [
          { id: 'coordinacion', title: t('role.coordinacion.title'), detail: t('role.coordinacion.detail') },
          { id: 'sistema', title: t('role.sistema.title'), detail: t('role.sistema.detail') },
        ]
      : []),
  ]);

  async function add() {
    failed = false;
    try {
      const { invitation } = await session.api<{ invitation: string }>('/users', { method: 'POST', body: { name, phone, role, table, unit, days: electionDays.length > 1 && shift.length < electionDays.length ? shift : undefined } });
      nav.replace('invite', { name, phone, token: invitation });
    } catch {
      failed = true;
    }
  }
</script>

<Pantalla accion="equipo" volver titulo={label ?? t('person.title')} desliza>
  <label class="campo"><span>{t('person.name')}</span><input bind:value={name} data-testid="person-name" /></label>
  <label class="campo"><span>{t('person.phone')}</span><input bind:value={phone} type="tel" data-testid="person-phone" /></label>
  <p class="aclara">{t('person.phone.hint')}</p>
  {#if !fixedRole}
    <p class="etiqueta">{t('person.what')}</p>
    <Options items={options} bind:value={chosenRole} />
    {#if !advanced}<button class="enlace" onclick={() => (advanced = true)}>{t('person.moreRoles')}</button>{/if}
  {/if}
  {#if electionDays.length > 1}
    <p class="etiqueta">{t('person.days')}</p>
    <div class="opciones">
      {#each freeDays as day (day)}
        <button class="opcion" class:elegida={shift.includes(day)} aria-pressed={shift.includes(day)} data-testid="shift-day" onclick={() => toggleDay(day)}>
          <span class="radio"></span><span><strong>{formatDay(day)}</strong></span>
        </button>
      {/each}
    </div>
  {/if}
  {#if !fixedRole && session.allows('users.manage')}
    <button class="enlace" onclick={() => nav.go('permissions')}>{t('person.permissions')}</button>
  {/if}
  {#if failed}<p class="problema" role="alert">{t('error.tryAgain')}</p>{/if}
  {#snippet pie()}
    <button class="boton primario" disabled={!name.trim() || !role || (electionDays.length > 1 && shift.length === 0)} onclick={add}><Ic name="sobre" /><span>{t('person.invite')}</span></button>
  {/snippet}
</Pantalla>
