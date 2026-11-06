<script lang="ts">
  import { groupProblems, MAX_ROLL_BYTES, readXlsxRoll, ROLL_READER_URL, ROLL_READER_URL_EN, writePadron, type PadronProblem } from '@urna-abierta/domain';
  import Ic from '../components/Ic.svelte';
  import Pantalla from '../components/Pantalla.svelte';
  import { i18n, rollProblem, t } from '../i18n.svelte.ts';
  import { nav } from '../nav.svelte.ts';
  import { ApiError, session } from '../session.svelte.ts';

  interface Summary {
    people: number;
    added: number;
    kept: number;
    missing: number;
    erased?: number;
    corrected?: number;
    toReview: number;
    withoutTable: number;
    problems?: PadronProblem[];
  }

  /** What goes to the server: a spreadsheet becomes a .padron here, so the server only ever gets a .padron or a CSV. */
  interface Upload {
    body: Blob;
    type: string;
  }

  /** More than this is a long list on a phone: the rest is counted. */
  const SHOWN = 20;

  let { election }: { election: string } = $props();

  let upload = $state.raw<Upload | null>(null);
  let summary = $state.raw<Summary | null>(null);
  let problem = $state('');
  let problems = $state.raw<PadronProblem[]>([]);
  let pdf = $state(false);
  let working = $state(false);
  /** One line per kind of problem, with all its rows. */
  const groups = $derived(groupProblems(problems));
  const readerUrl = $derived(i18n.language === 'en' ? ROLL_READER_URL_EN : ROLL_READER_URL);

  const send = ({ body, type }: Upload, preview: boolean) =>
    session.api<Summary>(`/elections/${election}/roll${preview ? '?preview=1' : ''}`, { method: 'POST', raw: body, type });

  /** The server sends a place and a code for each problem, never what a row says. */
  const isProblem = (item: unknown): item is PadronProblem =>
    typeof item === 'object' && item !== null && typeof (item as PadronProblem).where === 'string' && typeof (item as PadronProblem).problem === 'string';

  /** Why it failed, in words: a file the server could not read, or a connection that did not get there. */
  function failed(error: unknown, fallback: string) {
    if (error instanceof ApiError && error.code === 'external_ai_forbidden') {
      problem = t('roll.upload.aiForbidden');
      return;
    }
    if (error instanceof ApiError && error.code === 'election_closed') {
      problem = t('roll.upload.closed');
      return;
    }
    const listed = error instanceof ApiError ? error.problems.filter(isProblem) : [];
    problems = listed;
    problem = listed.length > 0 || (error instanceof ApiError && error.status < 500) ? t('roll.upload.unreadable') : fallback;
  }

  const refused = (code: string) => ({ upload: null, problems: [{ where: 'file', problem: code }] });

  /** An old Excel file (.xls) starts like this; an OpenDocument one names its kind near the start. */
  const OLD_EXCEL = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

  /** A spreadsheet the app cannot read, by its name or by how it starts: it is never sent. */
  async function otherSpreadsheet(picked: File): Promise<boolean> {
    if (/\.(xls|ods|numbers)$/i.test(picked.name)) return true;
    const start = new Uint8Array(await picked.slice(0, 100).arrayBuffer());
    return OLD_EXCEL.every((byte, i) => start[i] === byte) || new TextDecoder('latin1').decode(start).includes('application/vnd.oasis.opendocument');
  }

  async function prepare(picked: File): Promise<{ upload: Upload; problems: PadronProblem[] } | { upload: null; problems: PadronProblem[] }> {
    if (picked.size > MAX_ROLL_BYTES) return refused('too_big');
    if (await otherSpreadsheet(picked)) return refused('other_spreadsheet');
    if (/\.xlsx$/i.test(picked.name)) {
      const read = readXlsxRoll(new Uint8Array(await picked.arrayBuffer()));
      if (!read.padron) return { upload: null, problems: read.problems };
      const body = new Blob([writePadron({ electors: read.padron.electors }) as Uint8Array<ArrayBuffer>], { type: 'application/zip' });
      return { upload: { body, type: 'application/zip' }, problems: read.problems };
    }
    return { upload: { body: picked, type: /\.(csv|txt)$/i.test(picked.name) ? 'text/csv' : 'application/zip' }, problems: [] };
  }

  async function read(event: Event & { currentTarget: HTMLInputElement }) {
    const input = event.currentTarget;
    const picked = input.files?.[0];
    // The same file can be chosen again after fixing it.
    input.value = '';
    if (!picked) return;
    problem = '';
    problems = [];
    summary = null;
    upload = null;
    // A scanned PDF needs the roll reader first: it is never sent.
    pdf = /\.pdf$/i.test(picked.name) || picked.type === 'application/pdf';
    if (pdf) return;
    working = true;
    try {
      const prepared = await prepare(picked);
      if (!prepared.upload) {
        // One reason about the whole file (an old format, too big) says it all; it is not that the file is something else.
        const whole = prepared.problems.length === 1 && prepared.problems[0]!.where === 'file' ? groupProblems(prepared.problems)[0] : undefined;
        problem = whole ? rollProblem(whole).text : t('roll.upload.unreadable');
        problems = whole ? [] : prepared.problems;
        return;
      }
      const result = await send(prepared.upload, true);
      summary = result;
      problems = [...prepared.problems, ...(result.problems ?? [])];
      upload = prepared.upload;
    } catch (error) {
      failed(error, t('error.tryAgain'));
    } finally {
      working = false;
    }
  }

  async function load() {
    if (!upload) return;
    working = true;
    try {
      await send(upload, false);
      nav.back();
    } catch (error) {
      failed(error, t('error.tryAgain'));
    } finally {
      working = false;
    }
  }
</script>

<Pantalla accion="eleccion" volver ojo={t('roll.upload.eyebrow')} titulo={t('roll.upload.title')} bajada={t('roll.upload.text')} desliza>
  {#if summary}
    <div class="tarjeta leido" data-testid="roll-summary">
      <strong>{t('roll.upload.people', { count: summary.people })}</strong>
      {#if summary.kept > 0}<span>{t('roll.upload.changes', { added: summary.added, missing: summary.missing })}</span>{/if}
      {#if summary.toReview > 0}<span>{t('roll.upload.toReview', { count: summary.toReview })}</span>{/if}
      {#if summary.corrected}<span>{t('roll.upload.corrected', { count: summary.corrected })}</span>{/if}
      {#if summary.erased}<span>{t('roll.upload.erased', { count: summary.erased })}</span>{/if}
    </div>
    {#if summary.missing > 0}<p class="resultado mal">{t('roll.upload.missing', { count: summary.missing })}</p>{/if}
  {/if}
  {#if problem}<p class="problema" role="alert">{problem}</p>{/if}
  {#if groups.length > 0}
    <div class="aviso-suave problemas" data-testid="roll-problems">
      <strong>{problem ? t('roll.upload.problems') : t('roll.upload.warnings')}</strong>
      <ul>
        {#each groups.slice(0, SHOWN) as group, index (index)}
          {@const said = rollProblem(group)}
          <li>{#if said.where}<b>{said.where}:</b>{' '}{/if}{said.text}</li>
        {/each}
      </ul>
      {#if groups.length > SHOWN}<span class="mas">{t('roll.upload.more', { count: groups.length - SHOWN })}</span>{/if}
    </div>
  {/if}
  {#if pdf}
    <div class="tarjeta pdf" role="alert" data-testid="roll-pdf">
      <strong>{t('roll.upload.pdf.title')}</strong>
      <span>{t('roll.upload.pdf.text')}</span>
      <a class="enlace" href={readerUrl} target="_blank" rel="noopener noreferrer">{t('roll.upload.reader')}</a>
    </div>
  {:else}
    <p class="aclara">{t('roll.upload.scanned')} <a class="enlace en-linea" href={readerUrl} target="_blank" rel="noopener noreferrer">{t('roll.upload.reader')}</a></p>
  {/if}
  {#snippet pie()}
    <div class="pila">
      {#if summary}
        <button class="boton primario" disabled={working} onclick={load}><Ic name="tilde" /><span>{t('roll.upload.load')}</span></button>
      {/if}
      <label class={summary ? 'boton secundario' : 'boton primario'}>
        <input class="oculto" type="file" accept=".padron,.zip,.csv,.txt,.xlsx,.xls,.ods,.pdf" data-testid="roll-file" onchange={read} disabled={working} />
        <span>{working ? t('roll.upload.reading') : summary || pdf || problem ? t('roll.upload.another') : t('roll.upload.choose')}</span>
      </label>
    </div>
  {/snippet}
</Pantalla>

<style>
  .problemas ul { margin: 0; padding: 0 0 0 18px; display: flex; flex-direction: column; gap: 4px; font-size: 16px; }
  .problemas li { overflow-wrap: anywhere; }
  .mas { font-size: 16px; color: var(--suave); }
  .pdf { display: flex; flex-direction: column; gap: 6px; }
  .pdf .enlace { align-self: flex-start; font-size: 18px; font-weight: 700; }
  .en-linea { display: inline; padding: 0; }
</style>
