<script lang="ts">
  import { onMount } from 'svelte';
  import Ic from '../components/Ic.svelte';
  import Pantalla from '../components/Pantalla.svelte';
  import { t, type MessageKey } from '../i18n.svelte.ts';
  import { session } from '../session.svelte.ts';

  interface Roles {
    permissions: string[];
    recommended: Record<string, string[]>;
    edited: Record<string, string[]>;
    kept: Record<string, string[]>;
  }

  let data = $state.raw<Roles | null>(null);
  let role = $state<string | null>(null);
  let chosen = $state<string[]>([]);
  let saved = $state(false);

  const load = async () => {
    data = await session.api<Roles>('/roles');
  };
  onMount(load);

  const roleTitle = (id: string) => t(`role.${id}.title` as MessageKey);
  const label = (permission: string) => t(`perm.${permission}` as MessageKey);
  const isEdited = (id: string) => Boolean(data?.edited[id]);
  const kept = (permission: string) => Boolean(role && data?.kept[role]?.includes(permission));

  function open(id: string) {
    role = id;
    chosen = [...(data!.edited[id] ?? data!.recommended[id] ?? [])];
    saved = false;
  }

  const toggle = (permission: string) => {
    if (kept(permission)) return;
    chosen = chosen.includes(permission) ? chosen.filter((item) => item !== permission) : [...chosen, permission];
  };

  async function save(permissions: string[] | null) {
    await session.api(`/roles/${role}`, { method: 'PUT', body: { permissions } });
    await load();
    if (permissions === null) chosen = [...data!.recommended[role!]!];
    saved = true;
  }
</script>

{#if role && data}
  <Pantalla accion="seguridad" volver onback={() => (role = null)} ojo={t('permissions.eyebrow')} titulo={roleTitle(role)} desliza>
    <div class="opciones">
      {#each data.permissions as permission (permission)}
        <button class="opcion" class:elegida={chosen.includes(permission)} aria-pressed={chosen.includes(permission)} disabled={kept(permission)} data-testid="permission" onclick={() => toggle(permission)}>
          <span class="radio"></span><span><strong>{label(permission)}</strong></span>
        </button>
      {/each}
    </div>
    {#if saved}<p class="resultado bien" role="status"><Ic name="tilde" />{t('permissions.saved')}</p>{/if}
    {#if isEdited(role)}<button class="enlace" onclick={() => save(null)}>{t('permissions.reset')}</button>{/if}
    {#snippet pie()}
      <button class="boton primario" onclick={() => save(chosen)}><Ic name="tilde" /><span>{t('save')}</span></button>
    {/snippet}
  </Pantalla>
{:else}
  <Pantalla accion="seguridad" volver titulo={t('permissions.title')} bajada={t('permissions.text')} desliza>
    <div class="tarjetas">
      {#each Object.keys(data?.recommended ?? {}) as id (id)}
        <button class="tarjeta" data-testid="role" onclick={() => open(id)}>
          <strong>{roleTitle(id)}</strong>
          <span>{isEdited(id) ? t('permissions.edited') : t('permissions.recommended')}</span>
        </button>
      {/each}
    </div>
  </Pantalla>
{/if}
