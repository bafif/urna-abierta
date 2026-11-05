<script lang="ts">
  import Ic from '../components/Ic.svelte';
  import Pantalla from '../components/Pantalla.svelte';
  import { t } from '../i18n.svelte.ts';
  import { API, session } from '../session.svelte.ts';

  interface Person {
    election_id: string;
    election: string;
    id: string;
    full_name: string;
    document: string | null;
    table_name: string | null;
    has_mark: boolean;
    consent: { date: string; means: string } | null;
  }

  let query = $state('');
  let people = $state.raw<Person[]>([]);
  let person = $state.raw<Person | null>(null);
  let date = $state('');
  let means = $state('');
  let message = $state('');
  let fixedName = $state('');
  let fixedDocument = $state('');

  const base = $derived(person ? `/persons/${person.election_id}/${encodeURIComponent(person.id)}` : '');

  async function search() {
    people = (await session.api<{ people: Person[] }>(`/persons?q=${encodeURIComponent(query)}`)).people;
  }

  /** What is held about the person, in one file, to hand over when they ask. Art. 14. */
  async function exportData() {
    const response = await session.fetch(`${API}${base}/export`);
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = `datos-${person!.id}.json`;
    link.click();
    URL.revokeObjectURL(url);
    message = t('persons.exported');
  }

  function open(found: Person) {
    person = found;
    fixedName = found.full_name;
    fixedDocument = found.document ?? '';
    message = '';
  }

  /** Art. 16: whoever finds a mistake in their data has the right to have it corrected. */
  async function correct() {
    await session.api(`/elections/${person!.election_id}/electors/${encodeURIComponent(person!.id)}`, { method: 'PUT', body: { full_name: fixedName, document: fixedDocument } });
    person = { ...person!, full_name: fixedName.trim(), document: fixedDocument.replace(/\D/g, '') || person!.document };
    message = t('persons.corrected');
  }

  async function saveConsent() {
    await session.api(`${base}/consent`, { method: 'PUT', body: { date, means } });
    message = t('persons.consentSaved');
  }

  /** Art. 16. The row stays anonymous so that a table's totals still add up. */
  async function erase() {
    if (!confirm(t('persons.eraseConfirm', { name: person!.full_name }))) return;
    await session.api(base, { method: 'DELETE' });
    person = null;
    people = [];
    query = '';
    message = t('persons.erased');
  }
</script>

{#if person}
  <Pantalla accion="seguridad" volver onback={() => (person = null)} ojo={person.election} titulo={person.full_name} bajada={person.table_name ?? ''} desliza>
    <dl class="tabla-datos">
      <dt>{t('review.document')}</dt><dd>{person.document ?? '-'}</dd>
      <dt>{t('persons.light')}</dt><dd>{person.has_mark ? t('settings.yes') : t('settings.no')}</dd>
      {#if person.consent}<dt>{t('persons.consent')}</dt><dd>{person.consent.date}</dd>{/if}
    </dl>
    <button class="boton secundario" data-testid="person-export" onclick={exportData}>{t('persons.export')}</button>
    <p class="etiqueta">{t('persons.correct')}</p>
    <label class="campo"><span>{t('review.name')}</span><input bind:value={fixedName} data-testid="person-fix-name" /></label>
    <label class="campo"><span>{t('review.document')}</span><input bind:value={fixedDocument} inputmode="numeric" /></label>
    <button class="enlace" disabled={!fixedName.trim()} data-testid="person-fix" onclick={correct}>{t('persons.correct.save')}</button>
    <p class="etiqueta">{t('persons.consent')}</p>
    <label class="campo"><span>{t('persons.consentDate')}</span><input type="date" bind:value={date} /></label>
    <label class="campo"><span>{t('persons.consentMeans')}</span><input bind:value={means} /></label>
    <button class="enlace" disabled={!date || !means} onclick={saveConsent}>{t('save')}</button>
    {#if message}<p class="resultado bien" role="status"><Ic name="tilde" />{message}</p>{/if}
    {#snippet pie()}
      <button class="boton peligro" data-testid="person-erase" onclick={erase}>{t('persons.erase')}</button>
    {/snippet}
  </Pantalla>
{:else}
  <Pantalla accion="seguridad" volver titulo={t('persons.title')} bajada={t('persons.text')} desliza>
    <label class="buscar">
      <Ic name="lupa" />
      <input type="search" bind:value={query} placeholder={t('persons.search')} aria-label={t('persons.search')} autocomplete="off" onkeydown={(event) => event.key === 'Enter' && search()} />
    </label>
    <button class="boton secundario" disabled={query.trim().length < 3} onclick={search}>{t('persons.find')}</button>
    {#if message}<p class="resultado bien" role="status"><Ic name="tilde" />{message}</p>{/if}
    <div class="tarjetas compactas">
      {#each people as found (`${found.election_id}:${found.id}`)}
        <button class="tarjeta fila-mesa" data-testid="found-person" onclick={() => open(found)}>
          <strong>{found.full_name}</strong><span>{found.election}</span>
        </button>
      {/each}
    </div>
  </Pantalla>
{/if}
