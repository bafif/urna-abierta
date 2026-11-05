<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import Ic from '../components/Ic.svelte';
  import Pantalla from '../components/Pantalla.svelte';
  import { t, timeAgo } from '../i18n.svelte.ts';
  import { API, session } from '../session.svelte.ts';

  interface Detail {
    name: string;
    place: string;
    total: number;
    voted: number;
    fiscal: { name: string; phone: string | null } | null;
    categories: { id: string; name: string; lists: { id: string; name: string }[] }[];
    incidents: { id: string; at: string; kind: string }[];
    envelopes: { day: string; envelopes: number; marked: number; matches: boolean }[];
    photos: string[];
    tallies: { category: string; disagree: boolean; chosen: string | null; versions: { id: string; results: Record<string, number>; at: string }[] }[];
  }

  let { table }: { table: string } = $props();
  let detail = $state.raw<Detail | null>(null);
  let photos = $state.raw<string[]>([]);
  let problem = $state(false);
  let timer: ReturnType<typeof setInterval> | undefined;
  const REFRESH_MS = 20_000;

  async function load() {
    try {
      detail = await session.api<Detail>(`/tables/${table}/detail`);
      problem = false;
      const urls: string[] = [];
      for (const sha of detail.photos) {
        const response = await session.fetch(`${API}/tables/${table}/photos/${sha}`);
        if (response.ok) urls.push(URL.createObjectURL(await response.blob()));
      }
      photos.forEach((url) => URL.revokeObjectURL(url));
      photos = urls;
    } catch {
      problem = true;
    }
  }

  // It stays up to date by itself, like the panel: this is usually open while something is being resolved.
  onMount(() => {
    void load();
    timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, REFRESH_MS);
  });
  onDestroy(() => {
    clearInterval(timer);
    photos.forEach((url) => URL.revokeObjectURL(url));
  });

  async function resolve(id: string) {
    await session.api(`/incidents/${id}/resolve`, { method: 'POST' });
    await load();
  }

  async function decide(category: string, operation: string) {
    await session.api(`/tables/${table}/tally/decide`, { method: 'POST', body: { category, operation } });
    await load();
  }

  const categoryOf = (id: string) => detail?.categories.find((item) => item.id === id);
  const listName = (category: string, list: string) => categoryOf(category)?.lists.find((item) => item.id === list)?.name ?? list;
  const firstName = $derived(detail?.fiscal?.name.split(' ')[0] ?? '');
</script>

{#if detail}
  <Pantalla accion="aviso" volver ojo={detail.place ? `${detail.name} · ${detail.place}` : detail.name} titulo={detail.incidents.length > 0 ? t('table.urgent', { name: firstName }) : detail.name} desliza>
    {#each detail.incidents as incident (incident.id)}
      <div class="tarjeta alerta">
        <strong>{t('table.urgentCard')}</strong><span>{timeAgo(incident.at)}</span>
        <button class="enlace" data-testid="resolve" onclick={() => resolve(incident.id)}>{t('table.resolved')}</button>
      </div>
    {/each}
    <div class="dos-datos">
      <div><strong class="cifra" data-testid="voted">{detail.voted}</strong><span>{t('table.voted')}</span></div>
      <div><strong class="cifra">{detail.total - detail.voted}</strong><span>{t('table.left')}</span></div>
    </div>
    {#if detail.envelopes.length > 0}
      <p class="etiqueta">{t('table.envelopes')}</p>
      {#each detail.envelopes as count}
        <p class="resultado {count.matches ? 'bien' : 'mal'}" data-testid="envelope-count">{t(count.matches ? 'table.envelopes.match' : 'table.envelopes.differ', { day: count.day, envelopes: count.envelopes, marked: count.marked })}</p>
      {/each}
    {/if}
    {#each detail.tallies as tally (tally.category)}
      <p class="etiqueta">{categoryOf(tally.category)?.name ?? tally.category}</p>
      {#if tally.disagree}<p class="resultado mal">{t('table.tally.differ')}</p>{/if}
      {#each tally.versions as version (version.id)}
        <div class="tarjeta">
          {#each Object.entries(version.results) as [list, votes]}
            <span>{listName(tally.category, list)}: <b>{votes}</b></span>
          {/each}
          {#if tally.disagree}
            <button class="enlace" data-testid="choose-tally" onclick={() => decide(tally.category, version.id)}>{t('table.tally.choose')}</button>
          {:else if tally.chosen === version.id}
            <span><b>{t('table.tally.chosen')}</b></span>
          {/if}
        </div>
      {/each}
    {/each}
    {#each photos as photo}
      <p class="etiqueta">{t('table.photo')}</p>
      <a href={photo} target="_blank" rel="noreferrer"><img class="foto-chica" src={photo} alt={t('photo.alt')} data-testid="tally-photo" /></a>
    {/each}
    {#if detail.photos.length > photos.length}
      <p class="aclara" data-testid="photo-waiting">{t('table.photo.waiting')}</p>
    {/if}
    {#snippet pie()}
      {#if detail?.fiscal?.phone}
        <a class="boton {detail.incidents.length > 0 ? 'peligro' : 'secundario'}" href="tel:{detail.fiscal.phone}"><Ic name="tel" /><span>{t('alert.call', { name: firstName })}</span></a>
      {/if}
    {/snippet}
  </Pantalla>
{:else}
  <Pantalla volver titulo={problem ? t('error.tryAgain') : ''} />
{/if}
