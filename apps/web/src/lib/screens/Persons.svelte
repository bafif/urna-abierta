<script lang="ts">
  import Ic from '../components/Ic.svelte';
  import Pantalla from '../components/Pantalla.svelte';
  import { i18n, t } from '../i18n.svelte.ts';
  import { personDataFile, personDataPage, type PersonData } from '../person-data.ts';
  import { session } from '../session.svelte.ts';

  interface Person {
    election_id: string;
    election: string;
    id: string;
    full_name: string;
    document: string | null;
    table_name: string | null;
    has_mark: boolean;
    consent: { date: string; means: string; withdrawn?: { date: string; means: string } } | null;
  }

  let query = $state('');
  let people = $state.raw<Person[]>([]);
  let person = $state.raw<Person | null>(null);
  let date = $state('');
  let means = $state('');
  let message = $state('');
  let fixedName = $state('');
  let fixedDocument = $state('');
  /** A screen of its own inside the person's: correcting, or writing down that they took their consent back. */
  let doing = $state<'correct' | 'withdraw' | null>(null);

  const base = $derived(person ? `/persons/${person.election_id}/${encodeURIComponent(person.id)}` : '');

  async function search() {
    people = (await session.api<{ people: Person[] }>(`/persons?q=${encodeURIComponent(query)}`)).people;
  }

  /** What is held about the person, as a page they can read and print, to hand over when they ask. Arts. 14 and 15. */
  async function exportData() {
    const data = await session.api<PersonData>(`${base}/export`);
    const page = new Blob([personDataPage(data, t, i18n.language)], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(page);
    const link = document.createElement('a');
    link.href = url;
    link.download = personDataFile(data.person.name);
    link.click();
    URL.revokeObjectURL(url);
    message = t('persons.exported');
  }

  function open(found: Person) {
    person = found;
    doing = null;
    fixedName = found.full_name;
    fixedDocument = found.document ?? '';
    message = '';
  }

  /** Art. 16: whoever finds a mistake in their data has the right to have it corrected. */
  async function correct() {
    await session.api(base, { method: 'PUT', body: { full_name: fixedName, document: fixedDocument } });
    person = { ...person!, full_name: fixedName.trim(), document: fixedDocument.replace(/\D/g, '') || person!.document };
    doing = null;
    message = t('persons.corrected');
  }

  async function saveConsent() {
    await session.api(`${base}/consent`, { method: 'PUT', body: { date, means } });
    person = { ...person!, consent: { date, means } };
    date = '';
    means = '';
    message = t('persons.consentSaved');
  }

  /** They took it back: when and how stay, and their mark in the traffic light goes now. */
  async function withdraw() {
    await session.api(`${base}/consent/withdraw`, { method: 'POST', body: { date, means } });
    person = { ...person!, has_mark: false, consent: { ...person!.consent!, withdrawn: { date, means } } };
    date = '';
    means = '';
    doing = null;
    message = t('persons.withdrawn');
  }

  /** Only for a consent loaded by mistake: the log says it was removed. */
  async function removeConsent() {
    if (!confirm(t('persons.consent.removeConfirm'))) return;
    await session.api(`${base}/consent`, { method: 'DELETE' });
    person = { ...person!, consent: null };
    message = t('persons.consent.removed');
  }

  const day = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(i18n.language, { day: 'numeric', month: 'long', year: 'numeric' });

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

{#if person && doing === 'correct'}
  <Pantalla accion="seguridad" volver onback={() => (doing = null)} ojo={person.full_name} titulo={t('persons.correct')} desliza>
    <label class="campo"><span>{t('review.name')}</span><input bind:value={fixedName} data-testid="person-fix-name" /></label>
    <label class="campo"><span>{t('review.document')}</span><input bind:value={fixedDocument} inputmode="numeric" /></label>
    {#snippet pie()}
      <button class="boton primario" disabled={!fixedName.trim()} data-testid="person-fix" onclick={correct}><Ic name="tilde" /><span>{t('persons.correct.save')}</span></button>
    {/snippet}
  </Pantalla>
{:else if person && doing === 'withdraw'}
  <Pantalla accion="seguridad" volver onback={() => (doing = null)} ojo={person.full_name} titulo={t('persons.withdraw.title')} bajada={t('persons.withdraw.text')} desliza>
    <label class="campo"><span>{t('persons.withdraw.date')}</span><input type="date" bind:value={date} data-testid="withdraw-date" /></label>
    <label class="campo"><span>{t('persons.withdraw.means')}</span><input bind:value={means} data-testid="withdraw-means" /></label>
    {#snippet pie()}
      <button class="boton primario" disabled={!date || !means.trim()} data-testid="withdraw-save" onclick={withdraw}><Ic name="tilde" /><span>{t('persons.withdraw.save')}</span></button>
    {/snippet}
  </Pantalla>
{:else if person}
  <Pantalla accion="seguridad" volver onback={() => (person = null)} ojo={person.election} titulo={person.full_name} bajada={person.table_name ?? ''} desliza>
    <dl class="tabla-datos">
      <dt>{t('review.document')}</dt><dd>{person.document ?? '-'}</dd>
      <dt>{t('persons.light')}</dt><dd>{person.has_mark ? t('settings.yes') : t('settings.no')}</dd>
    </dl>
    {#if person.consent}
      <div class="tarjeta" data-testid="consent-card">
        <strong>{t('persons.consent.given')}</strong>
        <span>{t('persons.consent.when', { date: day(person.consent.date), means: person.consent.means })}</span>
        {#if person.consent.withdrawn}
          <span data-testid="consent-withdrawn">{t('persons.consent.withdrawnWhen', { date: day(person.consent.withdrawn.date), means: person.consent.withdrawn.means })}</span>
        {:else}
          <div class="renglon-botones">
            <button class="enlace" data-testid="consent-withdraw" onclick={() => (doing = 'withdraw')}>{t('persons.withdraw')}</button>
            <button class="enlace" data-testid="consent-remove" onclick={removeConsent}>{t('persons.consent.mistake')}</button>
          </div>
        {/if}
      </div>
    {:else}
      <p class="etiqueta">{t('persons.consent')}</p>
      <label class="campo"><span>{t('persons.consentDate')}</span><input type="date" bind:value={date} /></label>
      <label class="campo"><span>{t('persons.consentMeans')}</span><input bind:value={means} /></label>
      <button class="enlace" disabled={!date || !means} onclick={saveConsent}>{t('save')}</button>
    {/if}
    <button class="boton secundario" data-testid="person-export" onclick={exportData}>{t('persons.export')}</button>
    <div class="renglon-botones">
      <button class="enlace" data-testid="person-correct" onclick={() => (doing = 'correct')}>{t('persons.correct.open')}</button>
    </div>
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
