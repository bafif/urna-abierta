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
      'where.local.text': 'Para mirarla o hacer un simulacro antes de decidir. No sirve para una elección.',
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
      'local.text': 'Se levanta acá mismo. Sirve para mirarla y para un simulacro, no para una elección.',
      'local.only': 'Solo desde esta computadora',
      'local.only.text': 'Para mirarla. No sale nada de acá.',
      'local.phones': 'También desde los teléfonos',
      'local.phones.text': 'Abre un túnel de Cloudflare: una dirección https que anda en cualquier teléfono, con wifi o con datos, mientras esta computadora esté prendida. Todo lo que pasa por ahí, padrón incluido, atraviesa Cloudflare, y la dirección cambia cada vez que lo volvés a abrir.',
      'local.ok': 'Vamos a usar {engine}, que ya tenés instalado.',
      'local.none': 'Para esto hace falta Podman o Docker abierto. Instalá uno de los dos y volvé a esta pantalla.',
      'local.retry': 'Fijarme de nuevo',
      'vision.title': '¿Cómo leemos los padrones escaneados?',
      'vision.local': 'En esta computadora',
      'vision.local.text': 'El lector de padrones corre en tu computadora: es privado y gratis, y se baja aparte. Es lo recomendado, porque un padrón trae datos de personas.',
      'vision.later': 'Después',
      'vision.later.text': 'Una planilla de Excel o CSV se carga directo en la app. Un PDF escaneado lo leés con el lector de padrones cuando haga falta.',
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
      'log.tunnel': 'Abriendo la dirección para los teléfonos',
      'log.theme': 'Cargando tu tema',
      'log.cleanup': 'Borrando lo que se alcanzó a crear en la nube',
      'server.waiting_system': 'Esperando que el servidor termine de prepararse',
      'server.packages': 'Instalando lo necesario en el servidor',
      'server.swap': 'Agregando memoria de intercambio',
      'server.swap_failed': 'No se pudo agregar memoria de intercambio. Sigue sin ella',
      'server.firewall': 'Abriendo los puertos 80 y 443',
      'server.images_load': 'Cargando las imágenes',
      'server.images_pull': 'Bajando las imágenes',
      'server.starting': 'Arrancando',
      'server.ready': 'Listo en {detail}',
      'server.still_waiting': 'Arrancó en {detail}, pero todavía no responde. Casi siempre falta abrir los puertos 80 y 443 en el firewall de la nube: cuando estén abiertos, sigue solo. Si ya pasaron horas, reiniciá el servidor desde la nube y lo pide de nuevo',
      'failed.title': 'Algo no salió',
      'failed.text': 'No se llegó a terminar.',
      'failed.detail': 'Detalle:',
      'failed.cleaned': 'Lo que se había creado en la nube ya se borró: no queda nada cobrando.',
      'failed.left': 'No pudimos borrar esto en la nube: {list}. Borralo desde su consola, porque puede cobrar.',
      'failed.retry': 'Volver a intentar',
      'why.oracle_capacity': 'Oracle no tiene máquinas gratuitas libres en esa región ahora. Pasa seguido: probá de nuevo en unas horas.',
      'why.oracle_auth': 'Oracle no aceptó la clave de API. Revisá los OCID del usuario y del tenancy, la huella y la clave privada.',
      'why.oracle_region': 'Oracle no dejó crear el servidor. Fijate que la región sea la principal de tu cuenta (home region) y que el usuario sea administrador.',
      'why.oracle_limit': 'Tu cuenta de Oracle llegó a un límite de redes, direcciones o máquinas. Borrá en la consola lo que no uses y volvé a probar.',
      'why.aws_auth': 'AWS no aceptó la clave de acceso. Revisá las dos partes.',
      'why.aws_permission': 'Esa clave de AWS no puede crear servidores. Dale el permiso AmazonEC2FullAccess al usuario.',
      'why.aws_network': 'Tu cuenta de AWS no tiene en esa región la red que viene por defecto. Probá con sa-east-1, o creala en la consola: VPC, «Crear VPC predeterminada».',
      'why.aws_limit': 'AWS no deja crear más direcciones o máquinas en esa región. Liberá las que no uses, o probá otra región.',
      'why.aws_account': 'Tu cuenta de AWS todavía no está lista. Terminá de verificarla y volvé a probar.',
      'why.google_auth': 'Google no aceptó el archivo de la cuenta de servicio. Pegá el JSON completo, y fijate que esa clave no esté borrada.',
      'why.google_billing': 'El proyecto de Google no tiene la facturación activada.',
      'why.google_api': 'Falta activar la Compute Engine API en ese proyecto. Después de activarla, puede tardar unos minutos.',
      'why.google_permission': 'La cuenta de servicio no puede crear servidores. Dale el rol Administrador de Compute.',
      'why.google_capacity': 'Google no tiene esa máquina disponible ahora. Probá de nuevo en un rato.',
      'why.slow_cloud': 'La nube tardó demasiado en crear el servidor. Probá de nuevo en un rato.',
      'why.ssh': 'No pudimos entrar al servidor por SSH. Fijate la dirección, el usuario y la llave, y que el puerto 22 esté abierto.',
      'why.needs_debian': 'El servidor no tiene Ubuntu ni Debian. Por ahora hace falta uno de esos dos.',
      'why.apt': 'El servidor no pudo instalar lo que necesita. Suele pasar mientras se actualiza: esperá unos minutos y volvé a probar.',
      'why.script': 'La instalación se cortó en el servidor. En el detalle están sus últimas líneas.',
      'why.no_engine': 'Hace falta Podman o Docker abierto en esta computadora.',
      'why.no_tunnel': 'No se pudo abrir la dirección para los teléfonos. Revisá la conexión a internet y probá de nuevo, o elegí «Solo desde esta computadora».',
      'why.pull': 'No se pudieron bajar las imágenes de Urna Abierta. Fijate la conexión a internet y volvé a probar.',
      'why.port': 'Otros programas ya usan los puertos del 8090 al 8099 de esta computadora. Cerrá alguno y volvé a probar.',
      'why.unknown': 'No sabemos bien qué pasó. El detalle sirve para pedir ayuda.',
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
      'done.reader': 'Si tus padrones son PDF escaneados:',
      'done.reader.link': 'bajá el lector de padrones',
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
      'where.local.text': 'To look at it or run a drill before deciding. Not for an election.',
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
      'local.text': 'It runs right here. It is for looking at it and for a drill, not for an election.',
      'local.only': 'Only from this computer',
      'local.only.text': 'To look at it. Nothing leaves this computer.',
      'local.phones': 'From phones too',
      'local.phones.text': 'Opens a Cloudflare tunnel: an https address that works on any phone, on wifi or mobile data, while this computer is on. Everything that goes through it, the roll included, crosses Cloudflare, and the address changes every time you open it again.',
      'local.ok': 'We will use {engine}, which you already have.',
      'local.none': 'This needs Podman or Docker running. Install one of them and come back to this screen.',
      'local.retry': 'Check again',
      'vision.title': 'How do we read scanned rolls?',
      'vision.local': 'On this computer',
      'vision.local.text': 'The roll reader runs on your computer: private and free, and a separate download. A roll has people’s data: this is the recommended way.',
      'vision.later': 'Later',
      'vision.later.text': 'An Excel or CSV spreadsheet loads straight into the app. Read a scanned PDF with the roll reader whenever you need it.',
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
      'log.tunnel': 'Opening the address for phones',
      'log.theme': 'Loading your theme',
      'log.cleanup': 'Deleting what had been created in the cloud',
      'server.waiting_system': 'Waiting for the server to finish setting itself up',
      'server.packages': 'Installing what the server needs',
      'server.swap': 'Adding swap memory',
      'server.swap_failed': 'Swap memory could not be added. It goes on without it',
      'server.firewall': 'Opening ports 80 and 443',
      'server.images_load': 'Loading the images',
      'server.images_pull': 'Downloading the images',
      'server.starting': 'Starting',
      'server.ready': 'Ready at {detail}',
      'server.still_waiting': 'It started at {detail}, but it does not answer yet. Ports 80 and 443 almost always still have to be opened in the cloud firewall: once they are, it goes on by itself. If hours have gone by, restart the server from the cloud and it asks again',
      'failed.title': 'Something went wrong',
      'failed.text': 'It did not finish.',
      'failed.detail': 'Detail:',
      'failed.cleaned': 'What had been created in the cloud is already deleted: nothing is left charging.',
      'failed.left': 'We could not delete this in the cloud: {list}. Delete it from its console, because it may charge.',
      'failed.retry': 'Try again',
      'why.oracle_capacity': 'Oracle has no free machines available in that region right now. It happens often: try again in a few hours.',
      'why.oracle_auth': 'Oracle did not accept the API key. Check the user and tenancy OCIDs, the fingerprint and the private key.',
      'why.oracle_region': 'Oracle did not let the server be created. Check that the region is your account’s home region, and that the user is an administrator.',
      'why.oracle_limit': 'Your Oracle account reached a limit of networks, addresses or machines. Delete what you do not use in the console and try again.',
      'why.aws_auth': 'AWS did not accept the access key. Check both parts.',
      'why.aws_permission': 'That AWS key cannot create servers. Give the user the AmazonEC2FullAccess permission.',
      'why.aws_network': 'Your AWS account has no default network in that region. Try sa-east-1, or create it in the console: VPC, “Create default VPC”.',
      'why.aws_limit': 'AWS does not allow more addresses or machines in that region. Release the ones you do not use, or try another region.',
      'why.aws_account': 'Your AWS account is not ready yet. Finish verifying it and try again.',
      'why.google_auth': 'Google did not accept the service account file. Paste the whole JSON, and check that the key was not deleted.',
      'why.google_billing': 'The Google project does not have billing turned on.',
      'why.google_api': 'The Compute Engine API is not turned on in that project. After turning it on, it can take a few minutes.',
      'why.google_permission': 'The service account cannot create servers. Give it the Compute Admin role.',
      'why.google_capacity': 'Google does not have that machine available right now. Try again in a while.',
      'why.slow_cloud': 'The cloud took too long to create the server. Try again in a while.',
      'why.ssh': 'We could not get into the server over SSH. Check the address, the user and the key, and that port 22 is open.',
      'why.needs_debian': 'The server does not run Ubuntu or Debian. For now it needs one of those two.',
      'why.apt': 'The server could not install what it needs. It usually happens while it is updating itself: wait a few minutes and try again.',
      'why.script': 'The installation stopped on the server. Its last lines are in the detail.',
      'why.no_engine': 'Podman or Docker has to be open on this computer.',
      'why.no_tunnel': 'The address for phones could not be opened. Check the internet connection and try again, or choose «Only from this computer».',
      'why.pull': 'The Urna Abierta images could not be downloaded. Check the internet connection and try again.',
      'why.port': 'Other programs already use ports 8090 to 8099 on this computer. Close one of them and try again.',
      'why.unknown': 'We do not know exactly what happened. The detail helps when asking for help.',
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
      'done.reader': 'If your rolls are scanned PDFs:',
      'done.reader.link': 'download the roll reader',
    },
  };

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
    [/_did_not_start|_timeout$/, 'slow_cloud'],
    [/^script_failed:.*needs_debian/, 'needs_debian'],
    [/^script_failed:.*(apt|dpkg|lock)/i, 'apt'],
    [/^script_failed/, 'script'],
    [/^no_engine/, 'no_engine'],
    [/^no_tunnel/, 'no_tunnel'],
    [/^Command failed: \S+ pull /, 'pull'],
    [/address already in use|port is already allocated/, 'port'],
    [/authentication methods failed|ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|ENOTFOUND|handshake|privateKey|Cannot parse/i, 'ssh'],
  ];
  const why = (problem) => WHY.find(([pattern]) => pattern.test(problem ?? ''))?.[1] ?? 'unknown';
  const READER = {
    es: 'https://github.com/bafif/urna-abierta-padrones#descargar',
    en: 'https://github.com/bafif/urna-abierta-padrones/blob/main/README.en.md#download',
  };
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
          <p class="aclara">${t('cloud.note')} <a class="enlace ayuda-enlace" href="${GUIDE[state.language]}" target="_blank" rel="noreferrer">${t('cloud.guide')}</a></p>`,
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
          ${state.customProblems.length ? `<p class="problema" role="alert" data-testid="theme-problem">${state.customProblems.map(escape).join('<br>')}</p>` : ''}
        </div>
        <div class="vistas-previas" data-testid="previews">${preview('claro')}${preview('oscuro')}</div></div>`,
      next: ['theme.install', 'install'], back: 'vision',
    }),
    progress: () => ({
      title: t('progress.title'), text: t('progress.text'),
      body: `<ul class="progreso" data-testid="progress">${(state.job?.lines ?? []).map((line, index, lines) => {
        const [kind, detail] = line.split(/:(.*)/);
        const text = kind === 'server' ? serverLine(detail) : kind === 'pull' ? detail : t(`log.${kind}`);
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
        ${state.problem ? `<p class="problema" role="alert">${escape(state.problem)}</p>` : ''}`,
      next: [state.busy ? 'paste.checking' : 'paste.check', 'checkAddress'],
    }),
    done: () => ({
      title: t('done.title'), text: t('done.text'),
      body: `<div class="tarjeta llave"><span>${t('done.address')}</span><strong data-testid="address">${escape(state.result?.address)}</strong><span>${t('done.key')}</span><strong class="mono" data-testid="recovery-key">${escape(state.result?.recoveryKey)}</strong></div>
        ${state.result?.themeFailed ? `<p class="problema" role="alert" data-testid="theme-failed">${t('done.themeFailed')}</p>` : ''}
        <p class="aclara">${t('done.reader')} <a class="enlace ayuda-enlace" href="${READER[state.language]}" target="_blank" rel="noreferrer" data-testid="reader-link">${t('done.reader.link')}</a></p>`,
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
      local: () => ({ kind: 'local', phones: state.phones === 'phones' }),
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

  // The letters of every theme are here, and they are opened before drawing anything: a screen or a preview is never
  // painted while its letters are on their way. Some browsers kept what they had painted without them, with the steps
  // missing or a preview out of place, until something else changed.
  const letters = Promise.allSettled([...document.fonts].map((face) => face.load()));
  Promise.race([letters, new Promise((resolve) => setTimeout(resolve, 3_000))]).then(render);
})();
