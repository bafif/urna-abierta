// Screens of the proposal, with invented people. Every screen asks one thing and has one main button.
(() => {
  const icono = {
    flecha: '<path d="M5 12h13M12 6l6 6-6 6"/>',
    tilde: '<path d="M5 12.5l4.5 4.5L19 7"/>',
    tel: '<path d="M6 3h3l2 5-2.5 1.5a11 11 0 006 6L16 13l5 2v3a3 3 0 01-3 3A15 15 0 013 6a3 3 0 013-3z"/>',
    aviso: '<path d="M12 4l9 16H3zM12 10v4M12 17.5v.5"/>',
    lupa: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l5 5"/>',
    camara: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
    sobre: '<path d="M3 6h18v13H3zM3 7l9 7 9-7"/>',
    atras: '<path d="M19 12H6M12 6l-6 6 6 6"/>',
    mas: '<path d="M12 5v14M5 12h14"/>',
  };
  const svg = (name) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${icono[name]}</svg>`;

  const boton = (texto, { ir, tipo = 'primario', ic } = {}) =>
    `<button class="boton ${tipo}" ${ir ? `data-ir="${ir}"` : ''}>${ic ? svg(ic) : ''}<span>${texto}</span></button>`;
  const atras = '<button class="atras" aria-label="Volver" data-atras>' + svg('atras') + '<span>Volver</span></button>';

  const cabeza = ({ ojo, titulo, bajada, volver }) => `
    <header class="cabeza">
      ${volver ? atras : ''}
      <div class="logo-tema"></div>
      ${ojo ? `<p class="ojo">${ojo}</p>` : ''}
      <h1 class="t1">${titulo}</h1>
      ${bajada ? `<p class="bajada">${bajada}</p>` : ''}
    </header>`;

  const pantalla = (id, accion, { nota, ...cab }, cuerpo, pie) => ({
    id,
    nota,
    html: `<div class="pantalla-in" data-accion="${accion}">${cabeza(cab)}<main class="cuerpo">${cuerpo}</main>${pie ? `<footer class="pie">${pie}</footer>` : ''}</div>`,
  });

  const plan = (pasos) => `
    <ol class="plan">${pasos
      .map(([texto, cuando, estado, ayuda]) => `
        <li class="estacion ${estado}">
          <span class="punto">${estado === 'hecho' ? svg('tilde') : ''}</span>
          <div><strong>${texto}</strong><span class="cuando">${estado === 'ahora' ? 'Estás acá' : cuando}</span>${ayuda ? `<p class="ayuda">${ayuda}</p>` : ''}</div>
        </li>`)
      .join('')}</ol>`;

  const opciones = (lista, elegida = 0) => `
    <div class="opciones" data-grupo>${lista
      .map(([titulo, detalle], i) => `
        <button class="opcion ${i === elegida ? 'elegida' : ''}" data-opcion>
          <span class="radio"></span><span><strong>${titulo}</strong>${detalle ? `<small>${detalle}</small>` : ''}</span>
        </button>`)
      .join('')}</div>`;

  const teclado = (valor) => `
    <output class="numero-grande" data-numero>${valor}</output>
    <div class="teclado">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 'borrar', 0, 'ok']
      .map((k) => (k === 'ok' ? '<span></span>' : `<button class="tecla" data-tecla="${k}">${k === 'borrar' ? '←' : k}</button>`))
      .join('')}</div>`;

  const GENTE = [
    [24, 'Acuña, Martín', '066'], [25, 'Aguirre, Paula', '406'], [26, 'Álvarez, Inés', '812'], [27, 'Benítez, Tomás', '173'],
    [28, 'Cáceres, Belén', '590'], [29, 'Castaño, Ramiro', '227'], [30, 'Domínguez, Sofía', '348'],
  ];
  const fila = ([n, nombre, doc], tachada) => `
    <button class="fila ${tachada ? 'tachada' : ''}" data-fila>
      <span class="num">${n}</span><span class="nombre"><span class="nombre-t">${nombre}</span></span><span class="doc">…${doc}</span>
    </button>`;

  const padron = (id, nota, conSenal) => pantalla(id, 'tachar',
    { nota, volver: true, ojo: 'Mesa 12 · Día 1 de 3', titulo: '<span class="faltan" data-faltan>281</span><span class="de">faltan, de 350</span><button class="enlace en-titulo" data-ir="f-votaron">Ver los 69 que votaron</button>' },
    `${conSenal ? '' : `<p class="estado"><span class="foco"></span>Sin señal. Lo tuyo queda guardado y se manda solo.</p>`}
     <label class="buscar">${svg('lupa')}<input placeholder="Número o apellido" aria-label="Número o apellido"></label>
     <div class="lista" data-lista>${GENTE.map((p) => fila(p)).join('')}</div>
     <div class="deshacer" data-deshacer hidden><span></span><button>Deshacer</button></div>`,
    boton('Algo anda mal', { tipo: 'discreto-peligro', ir: 'f-aviso', ic: 'aviso' }));

  const FLUJOS = {
    fiscal: {
      titulo: 'Fiscal',
      explicacion: 'Lo abre por primera vez el día de la elección. No hay menú: la app le dice qué hacer ahora, y hay un solo botón principal por pantalla.',
      pantallas: [
        pantalla('f-hola', 'plan', { nota: 'Llega por un link o un QR, sin usuario ni contraseña. Primero sabe quién es y dónde está.', titulo: 'Hola, Marta', bajada: 'Sos fiscal de la mesa 12, en la Escuela Normal 1. Te vamos a ir diciendo qué hacer.' },
          '<div class="tarjeta dato"><span>Si tenés dudas, llamá a</span><strong>Rubén, tu jefe de distrito</strong></div>',
          boton('Empezar', { ir: 'f-tema', ic: 'flecha' })),
        { id: 'f-tema', nota: 'La primera vez que alguien abre la app, en el celular o en la computadora. Toda la pantalla cambia al probar: lo que ve es lo que va a tener. Un toque en «Usar este» y sigue, sin pensar. Probalo.', dinamica: 'primeraVez' },
        pantalla('f-plan', 'plan', { nota: 'Es la pantalla de inicio: una línea de estaciones. Siempre se ve qué ya pasó, dónde estás y qué sigue.', ojo: 'Martes 6 de abril', titulo: 'Lo que sigue' },
          plan([['Preparar la mesa', 'Hecho', 'hecho'], ['Tachar a quienes votan', 'Hoy, hasta las 18', 'ahora', 'Cuando alguien vote, buscalo en el padrón y tocá su nombre.'], ['Contar los sobres', 'Hoy, al cerrar', ''], ['Escrutinio', 'Jueves 8, al final', '']]),
          boton('Abrir el padrón', { ir: 'f-padron', ic: 'flecha' })),
        padron('f-padron', 'La pantalla de todo el día. Lo que importa es cuánto falta. Tocar un nombre lo tacha, y se puede deshacer. Probalo: tocá un nombre.', true),
        pantalla('f-votaron', 'tachar', { nota: 'Sin señal no pasa nada malo, y la app lo dice sin alarmar. Acá se ve cómo tacha cada tema.', volver: true, titulo: 'Ya votaron', bajada: '69 personas' },
          `<p class="estado"><span class="foco"></span>Sin señal. Lo tuyo queda guardado y se manda solo.</p>
           <div class="lista">${GENTE.slice(0, 5).map((p) => fila(p, true)).join('')}</div>`),
        pantalla('f-aviso', 'aviso', { nota: 'Lo urgente tiene dos caminos y ninguna pregunta de más. Llamar anda aunque no haya datos.', volver: true, titulo: '¿Qué pasó?', bajada: 'Rubén te va a ayudar.' },
          '<div class="tarjeta dato"><span>Si no hay señal para el aviso, igual podés llamar.</span></div>',
          `<div class="pila">${boton('Llamar a Rubén', { tipo: 'peligro', ic: 'tel' })}${boton('Mandarle un aviso', { tipo: 'secundario', ic: 'aviso' })}</div>`),
        pantalla('f-sobres', 'sobres', { nota: 'Al cerrar cada día: se abre la urna, se cuentan los sobres y se vuelve a cerrar. La app compara con los tachados.', ojo: 'Al cerrar, 18 h', titulo: '¿Cuántos sobres hay?', bajada: 'Contalos sin abrirlos y volvé a cerrar la urna.' },
          `${teclado('69')}<p class="resultado bien">${svg('tilde')}Coincide con los 69 que tachaste.</p>`,
          boton('Guardar', { ir: 'f-escrutinio', ic: 'tilde' })),
        pantalla('f-escrutinio', 'escrutinio', { nota: 'El escrutinio va de a una lista por vez. Nadie ve una planilla entera.', ojo: 'Escrutinio · Lista 2 de 5', titulo: '¿Cuántos votos sacó la Lista Azul?' },
          teclado('128'), boton('Siguiente', { ir: 'f-acta', ic: 'flecha' })),
        pantalla('f-acta', 'escrutinio', { nota: 'El último paso, y el cierre: gracias, y qué falta.', ojo: 'Último paso', titulo: 'Sacale una foto al acta', bajada: 'Que se lean bien los números. Después ya está: terminaste.' },
          '<div class="marco-foto"></div>', boton('Sacar la foto', { ic: 'camara' })),
      ],
    },
    administracion: {
      titulo: 'Administración',
      explicacion: 'Lo primero que ve quien instaló la app. El instalador ya resolvió el servidor: acá se arma el partido, de a una pregunta por vez. Se hace una sola vez.',
      pantallas: [
        pantalla('a-plan', 'partido', { nota: 'Cuatro estaciones. Puede cerrar y seguir mañana: la app recuerda dónde quedó.', titulo: 'Hola, Laura', bajada: 'Vamos a dejar todo listo en cuatro pasos.' },
          plan([['Tu partido', 'Su nombre', 'ahora', 'Empezamos por el nombre. Tarda un minuto.'], ['Tu equipo', 'Quién hace qué', ''], ['Seguridad', 'Qué tan delicada es', ''], ['Tu primera elección', 'Fechas, padrón y mesas', '']]),
          boton('Empezar', { ir: 'a-partido', ic: 'flecha' })),
        pantalla('a-partido', 'partido', { nota: 'Una pregunta, un campo.', volver: true, ojo: 'Paso 1 de 4', titulo: '¿Cómo se llama tu partido o agrupación?' },
          '<label class="campo"><input value="Agrupación Ejemplo" aria-label="Nombre"></label>',
          boton('Seguir', { ir: 'a-equipo', ic: 'flecha' })),
        pantalla('a-equipo', 'equipo', { nota: 'Sumar gente es lo único que hay que hacer acá. Cada persona recibe su link.', ojo: 'Paso 2 de 4', titulo: '¿Quién trabaja con vos?' },
          `<div class="tarjetas">
             <div class="tarjeta persona"><strong>Rubén Quiroga</strong><span>Jefe de distrito</span></div>
             <div class="tarjeta persona"><strong>Marta Ibáñez</strong><span>Fiscal</span></div>
             <div class="tarjeta persona"><strong>Juli Toledo</strong><span>Semáforo</span></div>
           </div>${boton('Sumar a alguien', { tipo: 'secundario', ic: 'mas', ir: 'a-rol' })}`,
          boton('Seguir', { ir: 'a-seguridad', ic: 'flecha' })),
        pantalla('a-rol', 'equipo', { nota: 'Roles en palabras, no una tabla de permisos. Los permisos vienen armados, y quien quiera los ajusta en «Ver permisos».', volver: true, titulo: '¿Qué va a hacer Rubén?' },
          opciones([['Cuidar una mesa', 'Fiscal: ve solo el padrón de su mesa.'], ['Ayudar a varios fiscales', 'Jefe de distrito: recibe sus avisos.'], ['Anotar quién nos vota', 'Semáforo: con un permiso aparte.'], ['Ver los números', 'Estadísticas: sin ningún nombre.']], 1) + '<button class="enlace">Ver permisos</button>',
          boton('Mandar invitación', { ic: 'sobre', ir: 'a-equipo' })),
        pantalla('a-seguridad', 'seguridad', { nota: 'Toda la seguridad se resuelve con una pregunta. Atrás quedan los valores recomendados de cada caso.', ojo: 'Paso 3 de 4', titulo: '¿Qué tan delicada es tu elección?', bajada: 'Podés cambiarlo cuando quieras.' },
          opciones([['Facultad o centro de estudiantes', 'Lo básico, sin complicarle la vida a nadie.'], ['Municipal o provincial', 'Más controles para los jefes.'], ['Nacional', 'Lo más estricto en todo.']]),
          boton('Seguir', { ir: 'a-elecciones', ic: 'flecha' })),
        pantalla('a-elecciones', 'eleccion', { nota: 'A partir de acá, esta es la pantalla de inicio: un partido usa la misma instalación para todas sus elecciones del año.', ojo: 'Agrupación Ejemplo', titulo: 'Tus elecciones' },
          `<div class="tarjetas">
             <div class="tarjeta eleccion"><strong>Centro de estudiantes</strong><span>6 al 8 de abril · Faltan cargar los fiscales</span></div>
             <div class="tarjeta eleccion apagada"><strong>Consejo Directivo</strong><span>Terminó el año pasado</span></div>
           </div>`,
          boton('Crear una elección', { ir: 'e-tipo', ic: 'mas' })),
      ],
    },
    eleccion: {
      titulo: 'Nueva elección',
      explicacion: 'Se repite cada vez que hay una elección. Reutiliza el partido y el equipo: solo pregunta lo que cambia.',
      pantallas: [
        pantalla('e-tipo', 'eleccion', { nota: 'El tipo define los valores recomendados de todo lo demás.', ojo: 'Nueva elección', titulo: '¿Qué elección es?' },
          opciones([['Facultad o centro de estudiantes', ''], ['Municipal o provincial', ''], ['Nacional', ''], ['Otra', '']]),
          boton('Seguir', { ir: 'e-dias', ic: 'flecha' })),
        { id: 'e-dias', nota: 'Puede durar varios días. Con eso, la app ya sabe cuándo cerrar la urna cada noche y cuándo pedir el escrutinio.', dinamica: 'calendario' },
        pantalla('e-padron', 'eleccion', { nota: 'Vale un PDF escaneado o una planilla. Lo lee en esta instalación, y lo dudoso se muestra para revisar: nunca se descarta en silencio.', volver: true, ojo: 'Padrón', titulo: 'Subí el padrón', bajada: 'Puede ser un PDF escaneado o una planilla.' },
          `<div class="tarjeta leido"><strong>3.120 personas</strong><span>Leímos el archivo. 14 filas quedan para que las mires.</span></div>${boton('Revisar las 14', { tipo: 'secundario' })}`,
          boton('Seguir', { ir: 'e-mesas', ic: 'flecha' })),
        pantalla('e-mesas', 'eleccion', { nota: 'La app propone, y la persona solo corrige si hace falta.', volver: true, ojo: 'Mesas', titulo: 'Te proponemos 9 mesas', bajada: 'De unas 350 personas cada una, por apellido.' },
          '<div class="tarjetas compactas">' + ['A a C', 'D a F', 'G a I', 'J a L'].map((t, i) => `<div class="tarjeta fila-mesa"><strong>Mesa ${i + 1}</strong><span>${t}</span></div>`).join('') + '</div><button class="enlace">Cambiar las mesas</button>',
          boton('Está bien', { ir: 'e-fiscales', ic: 'tilde' })),
        pantalla('e-fiscales', 'equipo', { nota: 'Lo que falta se ve primero. Un toque avisa a todo el equipo a la vez.', volver: true, ojo: 'Fiscales', titulo: 'Faltan 2 mesas sin fiscal' },
          '<div class="tarjetas compactas"><div class="tarjeta falta"><strong>Mesa 3</strong><span>Sin fiscal</span></div><div class="tarjeta falta"><strong>Mesa 7</strong><span>Sin fiscal</span></div><div class="tarjeta fila-mesa"><strong>Mesa 12</strong><span>Marta Ibáñez</span></div></div>',
          boton('Invitar a los fiscales', { ic: 'sobre' })),
      ],
    },
    jefe: {
      titulo: 'Jefe de distrito',
      explicacion: 'Tiene varias mesas a cargo. Ve primero lo que necesita algo, y lo demás se resume en una línea.',
      pantallas: [
        pantalla('j-distrito', 'aviso', { nota: 'No es un tablero de control: es una lista de lo que hay que resolver ahora.', ojo: 'Distrito Centro · 8 mesas', titulo: '2 mesas te necesitan' },
          `<div class="tarjetas">
             <button class="tarjeta alerta" data-ir="j-mesa"><strong>Mesa 12: aviso urgente</strong><span>Marta, hace 3 minutos</span></button>
             <button class="tarjeta" data-ir="j-mesa"><strong>Mesa 3: sin datos</strong><span>Hace 40 minutos. Puede ser falta de señal.</span></button>
           </div>
           <p class="resultado bien">${svg('tilde')}Las otras 6 andan bien.</p>`),
        pantalla('j-mesa', 'aviso', { nota: 'Lo que más hace un jefe es llamar: es el botón principal.', volver: true, ojo: 'Mesa 12 · Escuela Normal 1', titulo: 'Marta avisó que algo anda mal' },
          '<div class="dos-datos"><div><strong class="cifra">69</strong><span>votaron</span></div><div><strong class="cifra">281</strong><span>faltan</span></div></div>',
          boton('Llamar a Marta', { tipo: 'peligro', ic: 'tel' })),
      ],
    },
    otros: {
      titulo: 'Semáforo y estadísticas',
      explicacion: 'Los dos roles que trabajan con datos delicados. Ven lo justo: uno anota de a una persona, y el otro solo ve números.',
      pantallas: [
        pantalla('s-persona', 'equipo', { nota: 'Semáforo: una persona, una pregunta. Las categorías las define cada partido y arrancan vacías; esto es un ejemplo. Se edita solo con señal.', volver: true, ojo: 'Semáforo', titulo: 'Aguirre, Paula', bajada: 'Mesa 12, orden 25' },
          `<div class="opciones semaforo" data-grupo>
             <button class="opcion" data-opcion><span class="luz" style="background:#1E9E5A"></span><span><strong>Nos vota</strong></span></button>
             <button class="opcion elegida" data-opcion><span class="luz" style="background:#E8A317"></span><span><strong>Puede ser</strong></span></button>
             <button class="opcion" data-opcion><span class="luz" style="background:#D93A3A"></span><span><strong>No nos vota</strong></span></button>
           </div>`, boton('Guardar y seguir', { ic: 'flecha' })),
        pantalla('x-numeros', 'plan', { nota: 'Estadísticas: nunca aparece un nombre, y los grupos de menos de 5 personas no se muestran.', ojo: 'Centro de estudiantes · Día 1', titulo: '<span class="faltan">62 %</span><span class="de">ya votó</span>' },
          `<div class="barras">${[['Mañana', 71], ['Mediodía', 58], ['Tarde', 44]].map(([t, v]) => `<div class="barra"><span>${t}</span><i style="--v:${v}%"></i><b>${v} %</b></div>`).join('')}</div>`),
      ],
    },
  };

  const INSTALADOR = {
    titulo: 'Instalador',
    explicacion: 'Se baja de un release de GitHub y corre en la computadora del administrador. Pide todo lo técnico una sola vez, para que la app arranque directamente con el partido.',
    pantallas: [
      { id: 'i-hola', nota: 'Dice qué va a pasar y cuánto tarda, antes de pedir nada.', titulo: 'Vamos a instalar Urna Abierta', bajada: 'Tarda unos 15 minutos. Solo necesitás una cuenta en la nube, y te ayudamos a crearla.', cuerpo: '<div class="tarjeta"><strong>Vamos a preguntarte tres cosas</strong><span>Dónde va a vivir tu Urna Abierta, cómo leer los padrones y cómo querés que se vea. Lo demás lo hacemos solos.</span></div>', boton: ['Empezar', 'i-donde'] },
      { id: 'i-donde', nota: 'Las cuatro opciones funcionan, y cada una lleva a su propia guía. La primera es la más directa.', ojo: 'Paso 1 de 3', titulo: '¿Dónde va a vivir tu Urna Abierta?', cuerpo: opciones([['Crear un servidor nuevo', 'En Oracle, AWS o Google. Te guiamos con la cuenta y hacemos el resto.'], ['Ya tengo un servidor', 'Pegás su dirección y una llave SSH.'], ['Prefiero pegar un texto', 'Te damos un bloque para pegar al crear el servidor.'], ['Probar en esta computadora', 'Para mirarla antes de decidir. Solo se ve desde acá.']]), boton: ['Seguir', 'i-nube'] },
      { id: 'i-nube', nota: 'Oracle primero, porque es el único gratis sin plazo. La credencial se usa una vez y no se guarda.', ojo: 'Paso 1 de 3', titulo: '¿En qué nube?', cuerpo: opciones([['Oracle Cloud', 'Gratis y sin plazo. Recomendado.'], ['AWS', 'Gratis por 6 meses: alcanza para una elección.'], ['Google Cloud', 'Unos USD 3,65 por mes, por la dirección IP.']]) + '<label class="campo con-titulo"><span>Clave de acceso de tu cuenta</span><input value="" placeholder="Te mostramos cómo sacarla" aria-label="Clave"></label><p class="aclara">Se usa una sola vez, directamente con esa nube, para crear el servidor. No se guarda.</p>', boton: ['Crear el servidor', 'i-vision'] },
      { id: 'i-vision', nota: 'El modelo de visión se elige acá. Lo privado es lo recomendado, y queda claro qué implica cada opción.', ojo: 'Paso 2 de 3', titulo: '¿Cómo leemos los padrones escaneados?', cuerpo: opciones([['En esta computadora', 'Privado y gratis. Un padrón trae datos de personas: es lo recomendado.'], ['Con mi propia IA', 'Pegás tu clave. Los datos pasan por esa empresa.'], ['Después', 'Se puede elegir al cargar el primer padrón.']]), boton: ['Seguir', 'i-tema'] },
      { id: 'i-tema', nota: 'Todos los temas se pueden ver antes de elegir, en claro y en oscuro. Es el que van a ver todos al entrar, y cada persona lo puede cambiar en su teléfono.', dinamica: 'selectorInstalador', ojo: 'Paso 3 de 3', titulo: '¿Cómo querés que se vea?', boton: ['Instalar', 'i-listo'] },
      { id: 'i-listo', nota: 'Termina abriendo la app, que sigue con el partido. La llave es lo único que hay que guardar.', titulo: 'Tu Urna Abierta ya está andando', bajada: 'Guardá esta llave en un lugar seguro: sin ella no se pueden abrir tus copias de seguridad.', cuerpo: '<div class="tarjeta llave"><span>Dirección</span><strong>https://203.0.113.24</strong><span>Llave de recuperación</span><strong class="mono">TIZA-URNA-4821-SOBRE-7730</strong></div>', boton: ['Abrir Urna Abierta', 'a-plan'] },
    ],
  };

  window.URNA = { FLUJOS, INSTALADOR, GENTE, fila, svg, boton, cabeza, opciones, plan };
})();
