// The screens of the installer: one question per screen, and everything happens at the end.
(() => {
  const STRINGS = {
    es: {
      'hello.title': 'Vamos a instalar Urna Abierta',
      'hello.text': 'Tarda unos 15 minutos.',
      'hello.card.title': 'Vamos a preguntarte tres cosas',
      'hello.card.text': 'Dónde va a vivir tu Urna Abierta, cómo leer los padrones y cómo querés que se vea. Lo demás lo hacemos solos.',
      'hello.start': 'Empezar',
      'hello.language': 'Read this in English',
      'next': 'Seguir',
      'back': 'Volver',
      'rail.where': 'Dónde va a vivir',
      'rail.where.when': 'Tu servidor',
      'rail.vision': 'Cómo leer los padrones',
      'rail.vision.when': 'Con qué se leen',
      'rail.theme': 'Cómo se ve',
      'rail.theme.when': 'Su apariencia',
      'rail.install': 'Instalar',
      'rail.install.when': 'Lo hacemos solos',
      'rail.here': 'Estás acá',
      'rail.done': 'Hecho',
      'step1': 'Paso 1 de 3',
      'step2': 'Paso 2 de 3',
      'step3': 'Paso 3 de 3',
      'where.title': '¿Dónde va a vivir tu Urna Abierta?',
      'where.cloud': 'Crear un servidor nuevo',
      'where.cloud.text': 'En Oracle, AWS o Google. Te guiamos con la cuenta y hacemos el resto.',
      'where.ssh': 'Ya tengo un servidor',
      'where.ssh.text': 'Pegás su dirección y una llave SSH.',
      'where.text': 'Prefiero pegar un texto',
      'where.text.text': 'Te damos un bloque para pegar al crear el servidor. No nos das ninguna clave.',
      'where.local': 'Probar en esta computadora',
      'where.local.text': 'Para mirarla antes de decidir. Solo se ve desde acá.',
      'cloud.title': '¿En qué nube?',
      'cloud.oracle': 'Oracle Cloud',
      'cloud.oracle.text': 'Gratis y sin plazo. Recomendado.',
      'cloud.aws': 'AWS',
      'cloud.aws.text': 'Gratis por 6 meses: alcanza para una elección.',
      'cloud.google': 'Google Cloud',
      'cloud.google.text': 'Unos USD 3,65 por mes, por la dirección IP.',
      'cloud.note': 'Se usa una sola vez, directamente con esa nube, para crear el servidor. No se guarda.',
      'cloud.guide': 'Cómo sacar estos datos',
      'cloud.region': 'Región',
      'cloud.aws.key': 'Clave de acceso (Access key ID)',
      'cloud.aws.secret': 'Clave secreta (Secret access key)',
      'cloud.oracle.tenancy': 'OCID del tenancy',
      'cloud.oracle.user': 'OCID del usuario',
      'cloud.oracle.fingerprint': 'Huella (fingerprint)',
      'cloud.oracle.key': 'Clave privada de la API',
      'cloud.google.json': 'Contenido del archivo JSON de la cuenta de servicio',
      'cloud.invalid': 'Faltan datos, o el archivo no es el correcto.',
      'ssh.title': '¿Cuál es tu servidor?',
      'ssh.text': 'Tiene que ser Ubuntu o Debian. La dirección tiene que ser fija.',
      'ssh.address': 'Dirección (IP o dominio)',
      'ssh.user': 'Usuario',
      'ssh.key': 'Llave privada SSH',
      'ssh.bad_address': 'Esa dirección no parece válida.',
      'ssh.no_sudo': 'Entramos, pero ese usuario no puede actuar como administrador sin contraseña (sudo).',
      'ssh.cannot_connect': 'No pudimos entrar. Fijate la dirección, el usuario y la llave.',
      'ssh.checking': 'Comprobando…',
      'text.title': 'Vas a pegar un texto',
      'text.text': 'Al final te damos un bloque. Lo pegás en el campo de inicio (user data o cloud-init) al crear un servidor con Ubuntu en la nube que quieras.',
      'local.title': 'Probar en esta computadora',
      'local.text': 'Se levanta acá mismo, y solo se ve desde esta computadora. Sirve para mirarla, no para una elección.',
      'local.ok': 'Vamos a usar {engine}, que ya tenés instalado.',
      'local.none': 'Para esto hace falta Podman o Docker abierto. Instalá uno de los dos y volvé a esta pantalla.',
      'local.retry': 'Fijarme de nuevo',
      'vision.title': '¿Cómo leemos los padrones escaneados?',
      'vision.local': 'En esta computadora',
      'vision.local.text': 'Privado y gratis. Un padrón trae datos de personas: es lo recomendado.',
      'vision.later': 'Después',
      'vision.later.text': 'Se puede elegir al cargar el primer padrón.',
      'vision.ai': 'Con mi propia IA',
      'vision.ai.text': 'Todavía no está disponible.',
      'theme.title': '¿Cómo querés que se vea?',
      'theme.text': 'Es lo que van a ver todos al entrar. Cada persona lo puede cambiar en su teléfono.',
      'theme.sample.title': 'Ya votaron',
      'theme.sample.count': '69 personas',
      'theme.install': 'Instalar',
      'theme.custom': 'Usar un tema propio',
      'theme.custom.text': 'Arrastrá el archivo acá, o tocá para elegirlo.',
      'theme.custom.notTheme': 'Ese archivo no es un tema.',
      'theme.custom.taken': 'Ya hay un tema con ese id. Cambialo en tu archivo.',
      'theme.custom.refused': 'Ese tema no se puede usar:',
      'theme.custom.badFont': 'Una de las letras del archivo no se puede abrir: {name}',
      'progress.title': 'Instalando',
      'progress.text': 'Podés dejar esta ventana abierta y hacer otra cosa.',
      'log.address': 'Reservando una dirección fija',
      'log.network': 'Preparando la red',
      'log.image': 'Buscando el sistema',
      'log.server': 'Creando el servidor',
      'log.connecting': 'Entrando al servidor',
      'log.waiting': 'Esperando que arranque. Puede tardar varios minutos',
      'log.slow': 'Está tardando más de lo normal',
      'log.start': 'Arrancando',
      'log.theme': 'Cargando tu tema',
      'failed.title': 'Algo no salió',
      'failed.text': 'No se llegó a terminar. Esto dijo:',
      'failed.retry': 'Volver a intentar',
      'paste.title': 'Pegá este bloque al crear el servidor',
      'paste.text': 'Elegí Ubuntu 24.04, reservá una dirección fija y abrí los puertos 80 y 443. Pegá esto en «user data» o «cloud-init». Trae claves: no lo compartas.',
      'paste.copy': 'Copiar',
      'paste.copied': 'Copiado',
      'paste.address': 'Cuando el servidor esté creado, escribí su dirección',
      'paste.check': 'Comprobar',
      'paste.checking': 'Comprobando… puede tardar varios minutos.',
      'paste.not_yet': 'Todavía no responde. Puede tardar unos minutos: probá de nuevo en un rato.',
      'paste.bad_address': 'Esa dirección no parece válida.',
      'done.title': 'Tu Urna Abierta ya está andando',
      'done.text': 'Guardá esta llave en un lugar seguro: sin ella no se pueden abrir tus copias de seguridad.',
      'done.address': 'Dirección',
      'done.key': 'Llave de recuperación',
      'done.open': 'Abrir Urna Abierta',
      'done.saved': 'Ya guardé la llave',
      'done.themeFailed': 'No se pudo cargar tu tema propio. Cargalo desde la app, en Ajustes.',
    },
    en: {
      'hello.title': 'Let’s install Urna Abierta',
      'hello.text': 'It takes about 15 minutes.',
      'hello.card.title': 'We will ask you three things',
      'hello.card.text': 'Where your Urna Abierta will live, how to read the rolls, and how you want it to look. We do the rest.',
      'hello.start': 'Start',
      'hello.language': 'Leer en castellano',
      'next': 'Continue',
      'back': 'Back',
      'rail.where': 'Where it will live',
      'rail.where.when': 'Your server',
      'rail.vision': 'How to read the rolls',
      'rail.vision.when': 'What reads them',
      'rail.theme': 'How it looks',
      'rail.theme.when': 'Its appearance',
      'rail.install': 'Install',
      'rail.install.when': 'We do it for you',
      'rail.here': 'You are here',
      'rail.done': 'Done',
      'step1': 'Step 1 of 3',
      'step2': 'Step 2 of 3',
      'step3': 'Step 3 of 3',
      'where.title': 'Where will your Urna Abierta live?',
      'where.cloud': 'Create a new server',
      'where.cloud.text': 'On Oracle, AWS or Google. We guide you through the account and do the rest.',
      'where.ssh': 'I already have a server',
      'where.ssh.text': 'You paste its address and an SSH key.',
      'where.text': 'I prefer to paste a text',
      'where.text.text': 'We give you a block to paste when creating the server. You give us no keys.',
      'where.local': 'Try it on this computer',
      'where.local.text': 'To look at it before deciding. It can only be seen from here.',
      'cloud.title': 'Which cloud?',
      'cloud.oracle': 'Oracle Cloud',
      'cloud.oracle.text': 'Free with no time limit. Recommended.',
      'cloud.aws': 'AWS',
      'cloud.aws.text': 'Free for 6 months: enough for one election.',
      'cloud.google': 'Google Cloud',
      'cloud.google.text': 'About USD 3.65 a month, for the IP address.',
      'cloud.note': 'It is used only once, directly with that cloud, to create the server. It is not stored.',
      'cloud.guide': 'How to get this data',
      'cloud.region': 'Region',
      'cloud.aws.key': 'Access key ID',
      'cloud.aws.secret': 'Secret access key',
      'cloud.oracle.tenancy': 'Tenancy OCID',
      'cloud.oracle.user': 'User OCID',
      'cloud.oracle.fingerprint': 'Fingerprint',
      'cloud.oracle.key': 'API private key',
      'cloud.google.json': 'Contents of the service account JSON file',
      'cloud.invalid': 'Some data is missing, or the file is not the right one.',
      'ssh.title': 'What is your server?',
      'ssh.text': 'It has to be Ubuntu or Debian, and its address has to be fixed.',
      'ssh.address': 'Address (IP or domain)',
      'ssh.user': 'User',
      'ssh.key': 'SSH private key',
      'ssh.bad_address': 'That address does not look valid.',
      'ssh.no_sudo': 'We got in, but that user cannot act as administrator without a password (sudo).',
      'ssh.cannot_connect': 'We could not get in. Check the address, the user and the key.',
      'ssh.checking': 'Checking…',
      'text.title': 'You will paste a text',
      'text.text': 'At the end we give you a block. Paste it in the startup field (user data or cloud-init) when creating an Ubuntu server on any cloud.',
      'local.title': 'Try it on this computer',
      'local.text': 'It runs right here, and it can only be seen from this computer. It is for looking at it, not for an election.',
      'local.ok': 'We will use {engine}, which you already have.',
      'local.none': 'This needs Podman or Docker running. Install one of them and come back to this screen.',
      'local.retry': 'Check again',
      'vision.title': 'How do we read scanned rolls?',
      'vision.local': 'On this computer',
      'vision.local.text': 'Private and free. A roll has people’s data: this is the recommended way.',
      'vision.later': 'Later',
      'vision.later.text': 'You can choose when loading the first roll.',
      'vision.ai': 'With my own AI',
      'vision.ai.text': 'Not available yet.',
      'theme.title': 'How do you want it to look?',
      'theme.text': 'It is what everyone sees when they get in. Each person can change it on their phone.',
      'theme.sample.title': 'Already voted',
      'theme.sample.count': '69 people',
      'theme.install': 'Install',
      'theme.custom': 'Use your own theme',
      'theme.custom.text': 'Drag the file here, or tap to choose it.',
      'theme.custom.notTheme': 'That file is not a theme.',
      'theme.custom.taken': 'There is already a theme with that id. Change it in your file.',
      'theme.custom.refused': 'That theme cannot be used:',
      'theme.custom.badFont': 'One of the fonts in the file cannot be opened: {name}',
      'progress.title': 'Installing',
      'progress.text': 'You can leave this window open and do something else.',
      'log.address': 'Reserving a fixed address',
      'log.network': 'Preparing the network',
      'log.image': 'Finding the system',
      'log.server': 'Creating the server',
      'log.connecting': 'Getting into the server',
      'log.waiting': 'Waiting for it to start. It can take several minutes',
      'log.slow': 'It is taking longer than usual',
      'log.start': 'Starting',
      'log.theme': 'Loading your theme',
      'failed.title': 'Something went wrong',
      'failed.text': 'It did not finish. This is what it said:',
      'failed.retry': 'Try again',
      'paste.title': 'Paste this block when creating the server',
      'paste.text': 'Choose Ubuntu 24.04, reserve a fixed address and open ports 80 and 443. Paste this in “user data” or “cloud-init”. It has keys: do not share it.',
      'paste.copy': 'Copy',
      'paste.copied': 'Copied',
      'paste.address': 'Once the server is created, type its address',
      'paste.check': 'Check',
      'paste.checking': 'Checking… it can take several minutes.',
      'paste.not_yet': 'It does not answer yet. It can take a few minutes: try again in a while.',
      'paste.bad_address': 'That address does not look valid.',
      'done.title': 'Your Urna Abierta is running',
      'done.text': 'Keep this key somewhere safe: without it, your backups cannot be opened.',
      'done.address': 'Address',
      'done.key': 'Recovery key',
      'done.open': 'Open Urna Abierta',
      'done.saved': 'I saved the key',
      'done.themeFailed': 'Your own theme could not be loaded. Load it from the app, in Settings.',
    },
  };

  const GUIDE = 'https://github.com/bafif/urna-abierta/blob/main/docs/es/servidores.md';
  const REGIONS = { oracle: 'sa-saopaulo-1', aws: 'sa-east-1' };
  const LOGO = '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M7 15v21a6 6 0 006 6h22a6 6 0 006-6V15" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round"/><rect x="17" y="4" width="14" height="22" rx="2" fill="currentColor" transform="rotate(8 24 15)"/></svg>';
  const ICONS = { flecha: '<path d="M5 12h13M12 6l6 6-6 6"/>', tilde: '<path d="M5 12.5l4.5 4.5L19 7"/>', atras: '<path d="M19 12H6M12 6l-6 6 6 6"/>' };
  const icon = (name) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

  const state = {
    language: 'es',
    screen: 'hello',
    where: 'cloud',
    provider: 'oracle',
    form: {},
    vision: 'local',
    theme: 'aula',
    mode: matchMedia('(prefers-color-scheme: dark)').matches ? 'oscuro' : 'claro',
    engine: undefined,
    problem: '',
    busy: false,
    job: null,
    result: null,
    copied: false,
    custom: null,
    customProblems: [],
  };
  const BUILT_IN = window.TEMAS.map((item) => item.id);

  const t = (key, values = {}) => (STRINGS[state.language][key] ?? key).replace(/\{(\w+)\}/g, (_, name) => values[name] ?? '');
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
        <button class="enlace" data-action="language">${t('hello.language')}</button>`,
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
          <p class="aclara">${t('cloud.note')} <a class="enlace ayuda-enlace" href="${GUIDE}" target="_blank" rel="noreferrer">${t('cloud.guide')}</a></p>`,
        next: ['next', 'cloudNext'], back: 'where',
      };
    },
    ssh: () => ({
      eyebrow: t('step1'), title: t('ssh.title'), text: t('ssh.text'),
      body: `<div class="campos"><div class="doble">${field('address', t('ssh.address'))}${field('sshUser', t('ssh.user'), { value: 'ubuntu' })}</div>${field('privateKey', t('ssh.key'), { big: true })}</div>`,
      next: [state.busy ? 'ssh.checking' : 'next', 'sshNext'], back: 'where',
    }),
    text: () => ({ eyebrow: t('step1'), title: t('text.title'), text: t('text.text'), body: '', next: ['next', 'vision'], back: 'where' }),
    local: () => ({
      eyebrow: t('step1'), title: t('local.title'), text: t('local.text'),
      body: state.engine ? `<p class="resultado bien">${icon('tilde')}${t('local.ok', { engine: escape(state.engine) })}</p>` : state.engine === null ? `<p class="problema" role="alert">${t('local.none')}</p><button class="enlace" data-action="findEngine">${t('local.retry')}</button>` : '',
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
          ${state.customProblems.length ? `<p class="problema" role="alert" data-testid="theme-problem">${state.customProblems.map(escape).join('<br>')}</p>` : ''}
        </div>
        <div class="vistas-previas" data-testid="previews">${preview('claro')}${preview('oscuro')}</div></div>`,
      next: ['theme.install', 'install'], back: 'vision',
    }),
    progress: () => ({
      title: t('progress.title'), text: t('progress.text'),
      body: `<ul class="progreso" data-testid="progress">${(state.job?.lines ?? []).map((line, index, lines) => {
        const [kind, detail] = line.split(/:(.*)/);
        const text = kind === 'server' ? detail : kind === 'pull' ? detail : t(`log.${kind}`);
        if (kind === 'try') return '';
        return `<li>${index < lines.length - 1 ? icon('tilde') : '<span class="foco"></span>'}<span>${escape(text)}</span></li>`;
      }).join('')}</ul>`,
    }),
    failed: () => ({
      title: t('failed.title'), text: t('failed.text'),
      body: `<p class="problema" role="alert" data-testid="install-problem">${escape(state.problem)}</p>`,
      next: ['failed.retry', 'where'],
    }),
    paste: () => ({
      title: t('paste.title'), text: t('paste.text'),
      body: `<textarea class="bloque" readonly data-testid="paste-block">${escape(state.result?.text)}</textarea>
        <button class="boton secundario" data-action="copy">${state.copied ? t('paste.copied') : t('paste.copy')}</button>
        ${field('pasteAddress', t('paste.address'))}
        ${state.problem ? `<p class="problema" role="alert">${escape(state.problem)}</p>` : ''}`,
      next: [state.busy ? 'paste.checking' : 'paste.check', 'checkAddress'],
    }),
    done: () => ({
      title: t('done.title'), text: t('done.text'),
      body: `<div class="tarjeta llave"><span>${t('done.address')}</span><strong data-testid="address">${escape(state.result?.address)}</strong><span>${t('done.key')}</span><strong class="mono" data-testid="recovery-key">${escape(state.result?.recoveryKey)}</strong></div>
        ${state.result?.themeFailed ? `<p class="problema" role="alert" data-testid="theme-failed">${t('done.themeFailed')}</p>` : ''}`,
      next: ['done.open', 'openApp'],
    }),
  };

  function render() {
    const screen = SCREENS[state.screen]();
    const theme = tema();
    const recipes = Object.entries(window.URNA_TEMA.recetas(theme)).map(([k, v]) => `${k}="${v}"`).join(' ');
    document.documentElement.lang = state.language;
    const focused = document.activeElement?.dataset?.field;
    document.getElementById('app').innerHTML = `
      <div class="ventana" ${recipes} style="${window.URNA_TEMA.variables(theme, state.mode, 'plan').replaceAll('"', '&quot;')}">
        ${rail()}
        <section class="ventana-derecha">
          ${screen.eyebrow ? `<p class="ojo">${screen.eyebrow}</p>` : ''}
          <h1 class="t1">${screen.title}</h1>
          ${screen.text ? `<p class="bajada">${screen.text}</p>` : ''}
          <div class="cuerpo-v">${screen.body}${state.problem && state.screen !== 'paste' && state.screen !== 'failed' ? `<p class="problema" role="alert">${escape(state.problem)}</p>` : ''}</div>
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

  const sshTarget = () => ({ host: (state.form.address ?? '').trim().replace(/^https?:\/\//, ''), user: (state.form.sshUser ?? 'ubuntu').trim(), privateKey: state.form.privateKey ?? '' });

  function request() {
    const where = {
      cloud: () => ({ kind: 'cloud', provider: state.provider, credentials: cloudCredentials() }),
      ssh: () => ({ kind: 'ssh', address: state.form.address, target: sshTarget() }),
      text: () => ({ kind: 'text' }),
      local: () => ({ kind: 'local' }),
    }[state.where]();
    return { where, theme: state.theme, vision: state.vision, ...(state.custom ? { customTheme: state.custom } : {}) };
  }

  async function follow() {
    state.job = await (await fetch('api/job')).json();
    if (!state.job.finished) {
      render();
      setTimeout(follow, 1_500);
      return;
    }
    if (state.job.problem) {
      state.problem = state.job.problem;
      state.screen = 'failed';
    } else {
      state.result = state.job.result;
      state.screen = state.result.text ? 'paste' : 'done';
    }
    // Credentials are not kept once they have been used.
    state.form = {};
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
        state.problem = t('cloud.invalid');
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
      state.problem = t(`ssh.${result}`);
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
      state.problem = t(`paste.${result}`);
      render();
    },
    openApp: () => post('open', { url: state.result.setupLink }),
  };

  /** A theme from a file: it is checked here and also by the server that receives it. */
  async function loadTheme(file) {
    state.customProblems = [];
    let theme;
    try {
      if (file.size > 24 * 1024 * 1024) throw new Error('too large');
      theme = JSON.parse(await file.text());
    } catch {
      state.customProblems = [t('theme.custom.notTheme')];
      return render();
    }
    if (BUILT_IN.includes(theme?.id)) {
      state.customProblems = [t('theme.custom.taken')];
      return render();
    }
    const { problems } = await post('check-theme', { theme });
    if (problems.length > 0) {
      state.customProblems = [t('theme.custom.refused'), ...problems.slice(0, 3)];
      return render();
    }
    // Its fonts have to open here too: this is the preview of what everyone is going to see.
    const faces = (theme.archivosFuentes ?? []).map((font) => new FontFace(font.familia, `url(${font.datos})`, { weight: font.peso ?? 'normal', style: font.estilo ?? 'normal', stretch: font.ancho ?? 'normal' }));
    const opened = await Promise.allSettled(faces.map((face) => face.load()));
    const broken = opened.findIndex((result) => result.status === 'rejected');
    if (broken !== -1) {
      state.customProblems = [t('theme.custom.badFont', { name: theme.archivosFuentes[broken].familia })];
      return render();
    }
    faces.forEach((face) => document.fonts.add(face));
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

  document.addEventListener('click', async (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    const { go: target, where, provider, vision, theme, action } = button.dataset;
    if (where) state.where = where;
    if (provider) {
      state.provider = provider;
      state.form = {};
    }
    if (vision) state.vision = vision;
    if (theme) state.theme = theme;
    if (where || provider || vision || theme) return render();
    if (action === 'language') {
      state.language = state.language === 'es' ? 'en' : 'es';
      return render();
    }
    if (action === 'findEngine') {
      state.engine = (await (await fetch('api/state')).json()).engine;
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

  render();
})();
