// The screens of the installer: one question per screen, and everything happens at the end.
(() => {
  const STRINGS = window.INSTALLER_TEXTS;

  const GUIDE = {
    es: 'https://github.com/bafif/urna-abierta/blob/main/docs/es/servidores.md',
    en: 'https://github.com/bafif/urna-abierta/blob/main/docs/en/servers.md',
  };

  /** What usually causes each failure, from the code at the start of what the installer or the server said. */
  const WHY = [
    [/^oracle_no_capacity/, 'oracle_capacity'],
    [/^oracle_\w+: (NotAuthenticated|InvalidKey|401)/, 'oracle_auth'],
    [/^oracle_\w+: (LimitExceeded|QuotaExceeded)/, 'oracle_limit'],
    [/^oracle_\w+: (NotAuthorizedOrNotFound|404)/, 'oracle_region'],
    [/^aws_no_default_network/, 'aws_network'],
    [/^aws_\w+: (AuthFailure|InvalidClientTokenId|SignatureDoesNotMatch|UnrecognizedClient)/, 'aws_auth'],
    [/^aws_\w+: (UnauthorizedOperation|AccessDenied)/, 'aws_permission'],
    [/^aws_\w+: (\w*LimitExceeded|InsufficientInstanceCapacity)/, 'aws_limit'],
    [/^aws_\w+: (OptInRequired|PendingVerification|Blocked)/, 'aws_account'],
    [/^google_login/, 'google_auth'],
    [/^google_.*billing/i, 'google_billing'],
    [/^google_.*(Compute Engine API|has not been used|is disabled)/i, 'google_api'],
    [/^google_.*(permission|forbidden)/i, 'google_permission'],
    [/^google_.*(RESOURCE_POOL_EXHAUSTED|quota)/i, 'google_capacity'],
    [/^alpine_/, 'alpine'],
    [/_did_not_start|_timeout$/, 'slow_cloud'],
    [/^script_failed:.*needs_supported_linux/, 'needs_supported_linux'],
    [/^script_failed:.*(apt|dpkg|lock)/i, 'apt'],
    [/^script_failed/, 'script'],
    [/^no_engine/, 'no_engine'],
    [/host_changed/, 'host_changed'],
    [/^no_tunnel/, 'no_tunnel'],
    [/^Command failed: \S+ pull /, 'pull'],
    [/address already in use|port is already allocated/, 'port'],
    [/authentication methods failed|ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|ENOTFOUND|handshake|privateKey|Cannot parse/i, 'ssh'],
  ];
  const why = (problem) => WHY.find(([pattern]) => pattern.test(problem ?? ''))?.[1] ?? 'unknown';
  /** The legal text of the project; the app shows the one of its own version, without going online. */
  const LEGAL = {
    es: 'https://github.com/bafif/urna-abierta/blob/main/LEGAL.md',
    en: 'https://github.com/bafif/urna-abierta/blob/main/LEGAL.en.md',
  };
  const READER = {
    es: 'https://github.com/bafif/urna-abierta-padrones#descargar',
    en: 'https://github.com/bafif/urna-abierta-padrones/blob/main/README.en.md#download',
  };
  const REGIONS = { oracle: 'sa-saopaulo-1', aws: 'sa-east-1' };
  const LOGO = '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M7 15v21a6 6 0 006 6h22a6 6 0 006-6V15" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round"/><rect x="17" y="4" width="14" height="22" rx="2" fill="currentColor" transform="rotate(8 24 15)"/></svg>';
  const ICONS = { flecha: '<path d="M5 12h13M12 6l6 6-6 6"/>', tilde: '<path d="M5 12.5l4.5 4.5L19 7"/>', atras: '<path d="M19 12H6M12 6l-6 6 6 6"/>' };
  const icon = (name) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

  const state = {
    // The computer's languages until the person chooses, and then their choice: the installer remembers it.
    language: window.languageOf(navigator.languages?.length ? navigator.languages : [navigator.language ?? '']),
    screen: 'hello',
    where: 'cloud',
    provider: 'oracle',
    form: {},
    vision: 'local',
    phones: 'only',
    theme: 'aula',
    mode: matchMedia('(prefers-color-scheme: dark)').matches ? 'oscuro' : 'claro',
    engine: undefined,
    problem: '',
    left: null,
    busy: false,
    job: null,
    result: null,
    copied: false,
    custom: null,
    customProblems: [],
  };
  const BUILT_IN = window.TEMAS.map((item) => item.id);

  const t = (key, values = {}) => (STRINGS[state.language][key] ?? key).replace(/\{(\w+)\}/g, (_, name) => values[name] ?? '');
  /** A progress line of the server: a key, and sometimes a detail, like the address. */
  const serverLine = (detail) => {
    const [key, ...rest] = String(detail ?? '').split(' ');
    return STRINGS[state.language][`server.${key}`] ? t(`server.${key}`, { detail: rest.join(' ') }) : detail;
  };
  /** A problem is kept as its key, so that it follows the language if the person changes it. */
  const problemText = () => (state.problem?.key ? t(state.problem.key) : state.problem);
  /** What is wrong with a theme file: a text of this installer, or one the check gave in both languages. */
  const customProblemText = (problem) => (problem.key ? t(problem.key, problem.values) : problem[state.language]);
  const escape = (text) => String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const post = async (path, body) => (await fetch(`api/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) })).json();
  const tema = () => window.TEMAS.find((item) => item.id === state.theme) ?? window.TEMAS[0];

  const option = (id, title, text, chosen, attr, disabled) => `
    <button class="opcion ${id === chosen ? 'elegida' : ''}" data-${attr}="${id}" ${disabled ? 'disabled' : ''} role="radio" aria-checked="${id === chosen}">
      <span class="radio"></span><span><strong>${title}</strong>${text ? `<small>${text}</small>` : ''}</span>
    </button>`;

  const field = (name, label, { type = 'text', big = false, value } = {}) => `
    <label class="campo"><span>${label}</span>
      ${big ? `<textarea data-field="${name}" spellcheck="false">${escape(state.form[name])}</textarea>` : `<input data-field="${name}" type="${type}" autocomplete="off" spellcheck="false" value="${escape(state.form[name] ?? value ?? '')}">`}
    </label>`;

  function rail() {
    const steps = [['where', 0], ['vision', 1], ['theme', 2], ['install', 3]];
    const order = { hello: 0, where: 0, cloud: 0, ssh: 0, text: 0, local: 0, vision: 1, theme: 2, progress: 3, paste: 3, failed: 3, done: 4 };
    const now = order[state.screen];
    return `<aside class="riel"><div class="marca-app">${LOGO}<span>Urna Abierta</span></div>
      <ol class="plan">${steps.map(([key, index]) => {
        const status = index < now ? 'hecho' : index === now ? 'ahora' : '';
        return `<li class="estacion ${status}"><span class="punto">${status === 'hecho' ? icon('tilde') : ''}</span><div><strong>${t(`rail.${key}`)}</strong><span class="cuando">${status === 'ahora' ? t('rail.here') : status === 'hecho' ? t('rail.done') : t(`rail.${key}.when`)}</span></div></li>`;
      }).join('')}</ol></aside>`;
  }

  const SAMPLE = [[24, 'Acuña, Martín', '066'], [25, 'Aguirre, Paula', '406'], [26, 'Álvarez, Inés', '812'], [27, 'Benítez, Tomás', '173'], [28, 'Cáceres, Belén', '590']];
  const preview = (mode) => {
    const theme = tema();
    const recipes = Object.entries(window.URNA_TEMA.recetas(theme)).map(([k, v]) => `${k}="${v}"`).join(' ');
    return `<div class="marco"><div class="pantalla" ${recipes} style="${window.URNA_TEMA.variables(theme, mode, 'tachar').replaceAll('"', '&quot;')}">
      <div class="pantalla-in" data-accion="tachar">
        <header class="cabeza">${theme.logo ? `<div class="logo-tema"><img src="${escape(theme.logo)}" alt=""></div>` : ''}<h1 class="t1">${t('theme.sample.title')}</h1><p class="bajada">${t('theme.sample.count')}</p></header>
        <main class="cuerpo"><div class="lista">${SAMPLE.map(([n, name, doc]) => `<div class="fila tachada"><span class="num">${n}</span><span class="nombre"><span class="nombre-t">${name}</span></span><span class="doc">…${doc}</span></div>`).join('')}</div></main>
      </div></div></div>`;
  };

  const SCREENS = {
    hello: () => ({
      title: t('hello.title'), text: t('hello.text'),
      body: `<div class="tarjeta"><strong>${t('hello.card.title')}</strong><span>${t('hello.card.text')}</span></div>
        <p class="aclara" data-testid="hello-legal">${t('hello.legal')} <a class="enlace ayuda-enlace" href="${LEGAL[state.language]}" target="_blank" rel="noreferrer">${t('hello.legal.link')}</a></p>`,
      next: ['hello.start', 'where'], noBack: true,
    }),
    where: () => ({
      eyebrow: t('step1'), title: t('where.title'),
      body: `<div class="opciones" role="radiogroup">${[['cloud', 'where.cloud'], ['ssh', 'where.ssh'], ['text', 'where.text'], ['local', 'where.local']].map(([id, key]) => option(id, t(key), t(`${key}.text`), state.where, 'where')).join('')}</div>`,
      next: ['next', 'whereNext'], back: 'hello',
    }),
    cloud: () => {
      const forms = {
        oracle: `<div class="doble">${field('region', t('cloud.region'), { value: REGIONS.oracle })}${field('fingerprint', t('cloud.oracle.fingerprint'))}</div>${field('tenancy', t('cloud.oracle.tenancy'))}${field('user', t('cloud.oracle.user'))}${field('privateKey', t('cloud.oracle.key'), { big: true })}`,
        aws: `${field('region', t('cloud.region'), { value: REGIONS.aws })}${field('accessKeyId', t('cloud.aws.key'))}${field('secretAccessKey', t('cloud.aws.secret'), { type: 'password' })}`,
        google: field('json', t('cloud.google.json'), { big: true }),
      };
      return {
        eyebrow: t('step1'), title: t('cloud.title'),
        body: `<div class="opciones" role="radiogroup">${['oracle', 'aws', 'google'].map((id) => option(id, t(`cloud.${id}`), t(`cloud.${id}.text`), state.provider, 'provider')).join('')}</div>
          <div class="campos">${forms[state.provider]}</div>
          <p class="aclara">${t('cloud.note')} <a class="enlace ayuda-enlace" href="${GUIDE[state.language]}" target="_blank" rel="noreferrer">${t('cloud.guide')}</a></p>`,
        next: ['next', 'cloudNext'], back: 'where',
      };
    },
    ssh: () => ({
      eyebrow: t('step1'), title: t('ssh.title'), text: t('ssh.text'),
      body: `<div class="campos"><div class="doble">${field('address', t('ssh.address'))}${field('sshUser', t('ssh.user'), { value: 'ubuntu' })}</div>${field('privateKey', t('ssh.key'), { big: true })}
        <div class="doble">${field('sshPassword', t('ssh.password'), { type: 'password' })}${field('sshPort', t('ssh.port'), { value: '22' })}</div><p class="aclara">${t('ssh.password.text')}</p></div>`,
      next: [state.busy ? 'ssh.checking' : 'next', 'sshNext'], back: 'where',
    }),
    text: () => ({ eyebrow: t('step1'), title: t('text.title'), text: t('text.text'), body: '', next: ['next', 'vision'], back: 'where' }),
    local: () => ({
      eyebrow: t('step1'), title: t('local.title'), text: t('local.text'),
      body: state.engine ? `<p class="resultado bien">${icon('tilde')}${t('local.ok', { engine: escape(state.engine) })}</p>
        <div class="opciones" role="radiogroup">${option('only', t('local.only'), t('local.only.text'), state.phones, 'phones')}${option('phones', t('local.phones'), t('local.phones.text'), state.phones, 'phones')}</div>` : state.engine === null ? `<p class="problema" role="alert">${t('local.none')}</p><button class="enlace" data-action="findEngine">${t('local.retry')}</button>` : '',
      next: ['next', 'vision'], disabled: !state.engine, back: 'where',
    }),
    vision: () => ({
      eyebrow: t('step2'), title: t('vision.title'),
      body: `<div class="opciones" role="radiogroup">${option('local', t('vision.local'), t('vision.local.text'), state.vision, 'vision')}${option('ai', t('vision.ai'), t('vision.ai.text'), state.vision, 'vision', true)}${option('later', t('vision.later'), t('vision.later.text'), state.vision, 'vision')}</div>`,
      next: ['next', 'theme'], back: 'whereBack',
    }),
    theme: () => ({
      eyebrow: t('step3'), title: t('theme.title'), text: t('theme.text'),
      body: `<div class="vista-doble"><div class="columna-temas">
          <div class="opciones" role="radiogroup">${window.TEMAS.map((item) => option(item.id, escape(item.nombre), '', state.theme, 'theme')).join('')}</div>
          <label class="soltar" data-testid="theme-dropzone">
            <input class="oculto" type="file" accept=".json,application/json" data-testid="theme-file">
            <strong>${t('theme.custom')}</strong>${t('theme.custom.text')}
          </label>
          ${state.customProblems.length ? `<p class="problema" role="alert" data-testid="theme-problem">${state.customProblems.map((problem) => escape(customProblemText(problem))).join('<br>')}</p>` : ''}
        </div>
        <div class="vistas-previas" data-testid="previews">${preview('claro')}${preview('oscuro')}</div></div>`,
      next: ['theme.install', 'install'], back: 'vision',
    }),
    progress: () => ({
      title: t('progress.title'), text: t('progress.text'),
      body: `<ul class="progreso" data-testid="progress">${(state.job?.lines ?? []).map((line, index, lines) => {
        const [kind, detail] = line.split(/:(.*)/);
        const text = kind === 'server' ? serverLine(detail) : kind === 'pull' ? detail : kind === 'fingerprint' ? t('log.fingerprint', { fingerprint: detail }) : t(`log.${kind}`);
        if (kind === 'try') return '';
        return `<li>${index < lines.length - 1 ? icon('tilde') : '<span class="foco"></span>'}<span>${escape(text)}</span></li>`;
      }).join('')}</ul>`,
    }),
    failed: () => ({
      title: t('failed.title'), text: t('failed.text'),
      body: `<p class="problema" role="alert" data-testid="install-problem">${t(`why.${why(state.problem)}`)}</p>
        ${state.left ? `<p class="aclara" data-testid="install-cleanup">${state.left.length ? t('failed.left', { list: escape(state.left.join(', ')) }) : t('failed.cleaned')}</p>` : ''}
        <p class="aclara detalle" data-testid="install-detail">${t('failed.detail')} ${escape(state.problem)}</p>`,
      next: ['failed.retry', 'whereBack'],
    }),
    paste: () => ({
      title: t('paste.title'), text: t('paste.text'),
      body: `<textarea class="bloque" readonly data-testid="paste-block">${escape(state.result?.text)}</textarea>
        <button class="boton secundario" data-action="copy">${state.copied ? t('paste.copied') : t('paste.copy')}</button>
        ${field('pasteAddress', t('paste.address'))}
        ${state.problem ? `<p class="problema" role="alert">${escape(problemText())}</p>` : ''}`,
      next: [state.busy ? 'paste.checking' : 'paste.check', 'checkAddress'],
    }),
    done: () => {
      const result = state.result ?? {};
      if (result.answered === false && !result.local) {
        return {
          title: t('notYet.title'), text: t('notYet.text'),
          body: `<div class="tarjeta llave"><span>${t('done.address')}</span><strong data-testid="address">${escape(result.address)}</strong></div>
            <p class="aclara">${t('notYet.what')}</p>
            ${result.access ? `<p class="aclara">${t('notYet.key')}</p>${accessLink()}` : ''}
            ${state.problem ? `<p class="problema" role="alert">${escape(problemText())}</p>` : ''}`,
          next: [state.busy ? 'ssh.checking' : 'notYet.retry', 'checkAgain'],
        };
      }
      // On this computer there are no backups: no key to keep.
      const keep = !result.local;
      return {
        title: t('done.title'), text: keep ? t('done.text') : t('done.local.text'),
        body: `<div class="tarjeta llave"><span>${t('done.address')}</span><strong data-testid="address">${escape(result.address)}</strong>${keep ? `<span>${t('done.key')}</span><strong class="mono" data-testid="recovery-key">${escape(result.recoveryKey)}</strong>` : ''}</div>
          ${keep ? `<div class="acciones-llave"><button class="boton secundario" data-action="copyKey">${state.copiedKey ? t('done.copied') : t('done.copy')}</button>${result.access ? accessLink() : ''}</div>
            ${result.access ? `<p class="aclara">${t('done.access.text')}</p>` : ''}
            <label class="casilla"><input type="checkbox" data-check="saved" data-testid="key-saved" ${state.saved ? 'checked' : ''}><span>${t('done.saved')}</span></label>` : `<p class="aclara" data-testid="local-note">${t('done.local')}</p>`}
          ${result.themeFailed ? `<p class="problema" role="alert" data-testid="theme-failed">${t('done.themeFailed')}</p>` : ''}
          <p class="aclara">${t('done.reader')} <a class="enlace ayuda-enlace" href="${READER[state.language]}" target="_blank" rel="noreferrer" data-testid="reader-link">${t('done.reader.link')}</a></p>`,
        next: ['done.open', 'openApp'], disabled: keep && !state.saved,
      };
    },
  };

  /** The access file, made by this computer's installer: a pasted server passes the address it got. */
  const accessLink = () =>
    `<a class="boton secundario" data-testid="access-file" download="urna-abierta-acceso.zip" href="api/access?lang=${state.language}&address=${encodeURIComponent(state.result?.address ?? '')}">${t('done.access')}</a>`;

  function render() {
    const screen = SCREENS[state.screen]();
    const theme = tema();
    const recipes = Object.entries(window.URNA_TEMA.recetas(theme)).map(([k, v]) => `${k}="${v}"`).join(' ');
    document.documentElement.lang = state.language;
    document.title = t('title');
    const focused = document.activeElement?.dataset?.field;
    document.getElementById('app').innerHTML = `
      <div class="ventana" ${recipes} style="${window.URNA_TEMA.variables(theme, state.mode, 'plan').replaceAll('"', '&quot;')}">
        ${rail()}
        <section class="ventana-derecha">
          <button class="enlace idioma" data-action="language" lang="${state.language === 'es' ? 'en' : 'es'}">${t('language.other')}</button>
          ${screen.eyebrow ? `<p class="ojo">${screen.eyebrow}</p>` : ''}
          <h1 class="t1">${screen.title}</h1>
          ${screen.text ? `<p class="bajada">${screen.text}</p>` : ''}
          <div class="cuerpo-v">${screen.body}${state.problem && state.screen !== 'paste' && state.screen !== 'failed' ? `<p class="problema" role="alert">${escape(problemText())}</p>` : ''}</div>
          ${screen.next || screen.back ? `<div class="pie-v">
            ${screen.back ? `<button class="enlace" data-go="${screen.back}">${t('back')}</button>` : ''}
            ${screen.next ? `<button class="boton primario" data-go="${screen.next[1]}" ${screen.disabled || state.busy ? 'disabled' : ''}>${icon('flecha')}<span>${t(screen.next[0])}</span></button>` : ''}
          </div>` : ''}
        </section>
      </div>`;
    if (focused) document.querySelector(`[data-field="${focused}"]`)?.focus();
  }

  const go = (screen) => {
    state.problem = '';
    state.screen = screen;
    render();
  };

  /** What a person typed, as each cloud's client expects it. */
  function cloudCredentials() {
    const f = state.form;
    if (state.provider === 'aws') {
      if (!f.accessKeyId || !f.secretAccessKey) return null;
      return { region: f.region || REGIONS.aws, accessKeyId: f.accessKeyId.trim(), secretAccessKey: f.secretAccessKey.trim() };
    }
    if (state.provider === 'oracle') {
      if (!f.tenancy || !f.user || !f.fingerprint || !f.privateKey) return null;
      return { region: f.region || REGIONS.oracle, tenancy: f.tenancy.trim(), user: f.user.trim(), fingerprint: f.fingerprint.trim(), privateKey: f.privateKey };
    }
    try {
      const parsed = JSON.parse(f.json);
      return parsed.client_email && parsed.private_key && parsed.project_id ? parsed : null;
    } catch {
      return null;
    }
  }

  const sshTarget = () => ({
    host: (state.form.address ?? '').trim().replace(/^https?:\/\//, ''),
    port: Number(state.form.sshPort) || 22,
    user: (state.form.sshUser ?? 'ubuntu').trim(),
    privateKey: state.form.privateKey ?? '',
    ...(state.form.sshPassword ? { password: state.form.sshPassword } : {}),
  });

  function request() {
    const where = {
      cloud: () => ({ kind: 'cloud', provider: state.provider, credentials: cloudCredentials() }),
      ssh: () => ({ kind: 'ssh', address: state.form.address, target: sshTarget() }),
      text: () => ({ kind: 'text' }),
      local: () => ({ kind: 'local', phones: state.phones === 'phones' }),
    }[state.where]();
    return { where, theme: state.theme, vision: state.vision, language: state.language, ...(state.custom ? { customTheme: state.custom } : {}) };
  }

  async function follow() {
    state.job = await (await fetch('api/job')).json();
    if (!state.job.finished) {
      render();
      setTimeout(follow, 1_500);
      return;
    }
    if (state.job.problem) {
      // What was typed stays for trying again, only in this window, until it works.
      state.problem = state.job.problem;
      state.left = state.job.left;
      state.screen = 'failed';
    } else {
      state.result = state.job.result;
      state.screen = state.result.text ? 'paste' : 'done';
      // Credentials are not kept once the server exists.
      state.form = {};
    }
    render();
  }

  const ACTIONS = {
    whereNext: async () => {
      if (state.where === 'local') {
        state.engine = (await (await fetch('api/state')).json()).engine;
      }
      go(state.where);
    },
    whereBack: () => go(state.where),
    cloudNext: () => {
      if (!cloudCredentials()) {
        state.problem = { key: 'cloud.invalid' };
        render();
        return;
      }
      go('vision');
    },
    sshNext: async () => {
      state.busy = true;
      state.problem = '';
      render();
      const { result } = await post('check-ssh', { address: state.form.address ?? '', target: sshTarget() });
      state.busy = false;
      if (result === 'ok') {
        go('vision');
        return;
      }
      state.problem = { key: `ssh.${result}` };
      render();
    },
    install: async () => {
      state.screen = 'progress';
      state.job = null;
      render();
      await post('install', request());
      follow();
    },
    checkAddress: async () => {
      state.busy = true;
      state.problem = '';
      render();
      const { result, url, themeFailed } = await post('wait-address', { address: state.form.pasteAddress ?? '' });
      state.busy = false;
      if (result === 'ok') {
        state.result = { ...state.result, address: url, setupLink: `${url}/#setup=${state.result.setupCode}`, text: undefined, themeFailed };
        go('done');
        return;
      }
      state.problem = { key: `paste.${result}` };
      render();
    },
    openApp: () => post('open', { url: state.result.setupLink }),
    checkAgain: async () => {
      state.busy = true;
      state.problem = '';
      render();
      const { answered } = await post('check-again');
      state.busy = false;
      if (answered) state.result.answered = true;
      else state.problem = { key: 'notYet.still' };
      render();
    },
  };

  /** A theme from a file: it is checked here and also by the server that receives it. */
  async function loadTheme(file) {
    state.customProblems = [];
    let theme;
    try {
      if (file.size > 24 * 1024 * 1024) throw new Error('too large');
      theme = JSON.parse(await file.text());
    } catch {
      state.customProblems = [{ key: 'theme.custom.notTheme' }];
      return render();
    }
    if (BUILT_IN.includes(theme?.id)) {
      state.customProblems = [{ key: 'theme.custom.taken' }];
      return render();
    }
    const { problems } = await post('check-theme', { theme });
    if (problems.length > 0) {
      state.customProblems = [{ key: 'theme.custom.refused' }, ...problems.slice(0, 3)];
      return render();
    }
    // Its fonts have to open here too: this is the preview of what everyone is going to see.
    const faces = (theme.archivosFuentes ?? []).map((font) => new FontFace(font.familia, `url(${font.datos})`, { weight: font.peso ?? 'normal', style: font.estilo ?? 'normal', stretch: font.ancho ?? 'normal' }));
    const opened = await Promise.allSettled(faces.map((face) => face.load()));
    const broken = opened.findIndex((result) => result.status === 'rejected');
    if (broken !== -1) {
      state.customProblems = [{ key: 'theme.custom.badFont', values: { name: theme.archivosFuentes[broken].familia } }];
      return render();
    }
    faces.forEach((face) => document.fonts.add(face));
    // Its logo too, for the same reason as the letters at the start.
    if (theme.logo) {
      const logo = new Image();
      logo.src = theme.logo;
      await logo.decode().catch(() => undefined);
    }
    window.TEMAS.splice(0, window.TEMAS.length, ...window.TEMAS.filter((item) => BUILT_IN.includes(item.id)), theme);
    state.custom = theme;
    state.theme = theme.id;
    render();
  }

  // Dropping a file anywhere in the window counts, and elsewhere the browser must not open it instead of the installer.
  const dropzone = () => document.querySelector('[data-testid="theme-dropzone"]');
  document.addEventListener('dragover', (event) => {
    event.preventDefault();
    dropzone()?.classList.add('encima');
  });
  document.addEventListener('dragleave', (event) => {
    if (!event.relatedTarget) dropzone()?.classList.remove('encima');
  });
  document.addEventListener('drop', (event) => {
    event.preventDefault();
    dropzone()?.classList.remove('encima');
    const file = event.dataTransfer?.files?.[0];
    if (file && state.screen === 'theme') loadTheme(file);
  });
  document.addEventListener('change', (event) => {
    const file = event.target.dataset?.testid === 'theme-file' ? event.target.files?.[0] : null;
    if (file) loadTheme(file);
  });

  document.addEventListener('input', (event) => {
    const name = event.target.dataset?.field;
    if (name) state.form[name] = event.target.value;
  });

  document.addEventListener('change', (event) => {
    if (event.target.dataset?.check !== 'saved') return;
    state.saved = event.target.checked;
    render();
  });

  document.addEventListener('click', async (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    const { go: target, where, provider, vision, theme, phones, action } = button.dataset;
    if (where) state.where = where;
    if (provider) {
      state.provider = provider;
      state.form = {};
    }
    if (vision) state.vision = vision;
    if (theme) state.theme = theme;
    if (phones) state.phones = phones;
    if (where || provider || vision || theme || phones) return render();
    if (action === 'language') {
      state.language = state.language === 'es' ? 'en' : 'es';
      // Remembered on this computer: the next time the installer opens, it opens in this one.
      post('language', { language: state.language }).catch(() => undefined);
      return render();
    }
    if (action === 'findEngine') {
      state.engine = (await (await fetch('api/state')).json()).engine;
      return render();
    }
    if (action === 'copyKey') {
      await navigator.clipboard.writeText(state.result.recoveryKey);
      state.copiedKey = true;
      return render();
    }
    if (action === 'copy') {
      await navigator.clipboard.writeText(state.result.text);
      state.copied = true;
      return render();
    }
    if (target) {
      if (ACTIONS[target]) await ACTIONS[target]();
      else go(target);
    }
  });

  // The letters of every theme are here, and they are opened before drawing anything: a screen or a preview is never
  // painted while its letters are on their way. Some browsers kept what they had painted without them, with the steps
  // missing or a preview out of place, until something else changed.
  const letters = Promise.allSettled([...document.fonts].map((face) => face.load()));
  // The language chosen the last time, if there was one, before drawing anything too.
  const chosen = fetch('api/language')
    .then((response) => response.json())
    .then(({ language }) => {
      if (language === 'es' || language === 'en') state.language = language;
    })
    .catch(() => undefined);
  Promise.race([Promise.all([letters, chosen]), new Promise((resolve) => setTimeout(resolve, 3_000))]).then(render);
})();
