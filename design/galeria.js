// The gallery: applies a theme's data to the screens, and lets people try them.
(() => {
  const { FLUJOS, INSTALADOR, GENTE, fila, svg, boton, cabeza, opciones, plan } = window.URNA;
  const TEMAS = window.TEMAS;
  const estado = { vista: 'comparar', tema: 'aula', modo: 'claro', idioma: 'es' };
  for (const parte of location.hash.slice(1).split('&')) {
    const [clave, valor] = parte.split('=');
    if (clave in estado && valor) estado[clave] = valor;
  }

  const VISTAS = [['comparar', 'Comparar temas'], ...Object.entries(FLUJOS).map(([id, f]) => [id, f.titulo]), ['instalador', 'Instalador']];
  const raiz = document.getElementById('app');

  const logoUrna = '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M7 15v21a6 6 0 006 6h22a6 6 0 006-6V15" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round"/><rect x="17" y="4" width="14" height="22" rx="2" fill="currentColor" transform="rotate(8 24 15)"/></svg>';

  const { variables, atributos } = window.URNA_TEMA;

  const selectorTemas = (actual) => {
    const cuerpo = `<div class="muestras">${TEMAS.map((t) => {
      const c = t[estado.modo === 'oscuro' ? 'oscuro' : 'claro'];
      return `<button class="muestra ${t.id === actual.id ? 'elegida' : ''}" data-elegir-tema="${t.id}">
        <span class="aa" style="font-family:${t.fuentes.titulo.replaceAll('"', '')};font-weight:${t.forma.pesoTitulo}">Aa</span>
        <strong>${t.nombre}</strong>
        <span class="colores"><i style="background:${c.primario}"></i><i style="background:${c.fondo}"></i><i style="background:${c.marca}"></i></span>
      </button>`;
    }).join('')}</div><button class="enlace">Crear uno propio</button>`;
    return `<div class="pantalla-in" data-accion="partido">${cabeza({ volver: true, ojo: 'Paso 1 de 4', titulo: '¿Cómo querés que se vea?', bajada: 'Se puede cambiar después.' })}<main class="cuerpo">${cuerpo}</main><footer class="pie">${boton('Seguir', { ir: 'a-equipo', ic: 'flecha' })}</footer></div>`;
  };

  const calendario = () => {
    // April 2027 starts on a Thursday.
    const celdas = ['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((d) => `<b>${d}</b>`);
    for (let i = 0; i < 3; i += 1) celdas.push('<span></span>');
    for (let dia = 1; dia <= 30; dia += 1) celdas.push(`<span class="${dia >= 6 && dia <= 8 ? 'dia-elegido' : ''}">${dia}</span>`);
    return `<div class="pantalla-in" data-accion="eleccion">${cabeza({ volver: true, ojo: 'Abril de 2027', titulo: '¿Qué días se vota?', bajada: 'Tocá cada día.' })}<main class="cuerpo"><div class="mes">${celdas.join('')}</div><p class="resultado bien">${svg('tilde')}Son 3 días. La urna se cierra cada noche.</p></main><footer class="pie">${boton('Seguir', { ir: 'e-padron', ic: 'flecha' })}</footer></div>`;
  };

  /** The first time the app opens. The whole screen is the preview: what you see is what you get. */
  const primeraVez = (tema, modo) => {
    const posicion = TEMAS.findIndex((t) => t.id === tema.id) + 1;
    return `<div class="pantalla-in" data-accion="plan">${cabeza({ titulo: '¿Cómo te queda más cómodo?', bajada: 'Así se va a ver. Podés probar otras formas.' })}
      <main class="cuerpo">
        <p class="nombre-tema">${tema.nombre}<small>${posicion} de ${TEMAS.length}</small></p>
        <div class="muestra-lista lista">${GENTE.slice(0, 2).map((p) => fila(p, true)).join('')}${fila(GENTE[2])}</div>
        <div class="modos">
          <button class="modo" data-vista-modo="claro" aria-pressed="${modo === 'claro'}">Claro</button>
          <button class="modo" data-vista-modo="oscuro" aria-pressed="${modo === 'oscuro'}">Oscuro</button>
        </div>
      </main>
      <footer class="pie"><div class="pila">${boton('Usar este', { ic: 'tilde', tipo: 'primario' }).replace('<button', '<button data-usar-tema')}${boton('Ver otro', { tipo: 'secundario', ic: 'flecha' }).replace('<button', '<button data-ver-otro')}</div></footer>
    </div>`;
  };

  function htmlDe(pantalla, tema, modo) {
    if (pantalla.dinamica === 'primeraVez') return primeraVez(tema, modo);
    if (pantalla.dinamica === 'calendario') return calendario();
    return pantalla.html;
  }

  function telefono(pantalla, tema, modo, { mini = false, nota = true } = {}) {
    const accion = /data-accion="(\w+)"/.exec(htmlDe(pantalla, tema, modo))?.[1];
    return `<div class="celda ${mini ? 'mini' : ''}" data-celda="${pantalla.id}">
      <div class="marco"><div class="pantalla" ${atributos(tema)} data-tema="${tema.id}" data-modo="${modo}" style="${variables(tema, modo, accion)}">${htmlDe(pantalla, tema, modo)}</div></div>
      ${nota && pantalla.nota ? `<p class="nota">${pantalla.nota}</p>` : ''}
    </div>`;
  }

  const vistasPrevias = (tema) => {
    const muestra = FLUJOS.fiscal.pantallas.find((p) => p.id === 'f-votaron');
    return ['claro', 'oscuro'].map((m) => telefono(muestra, tema, m, { nota: false })).join('');
  };

  /** In the installer: every theme, seen in both modes before choosing. */
  const selectorInstalador = (tema) => `<div class="vista-doble">
      <div class="opciones" data-grupo>${TEMAS.filter((t) => !t.privado).map((t) => `<button class="opcion ${t.id === tema.id ? 'elegida' : ''}" data-opcion data-previa="${t.id}"><span class="radio"></span><span><strong>${t.nombre}</strong></span></button>`).join('')}
        <button class="enlace">Usar un tema propio</button>
      </div>
      <div class="vistas-previas" data-vistas>${vistasPrevias(tema)}</div>
    </div>`;

  /** Repaints a single screen in another theme, leaving the rest of the gallery alone. */
  function repintar(el, tema, modo) {
    const accion = 'plan';
    el.dataset.tema = tema.id;
    el.dataset.modo = modo;
    const r = tema.recetas;
    Object.assign(el.dataset, { tachado: r.tachado, fondo: r.fondo, material: r.material, cabecera: r.cabecera, decor: r.decor ?? '', sombraTitulo: String(Boolean(r.sombraTitulo)), pieBanda: String(Boolean(tema.claro.fondoPie)) });
    el.setAttribute('style', variables(tema, modo, accion));
    el.innerHTML = primeraVez(tema, modo);
    ponerLogos(el);
  }

  function ponerLogos(dentroDe) {
    dentroDe.querySelectorAll('.logo-tema').forEach((logo) => {
      const t = TEMAS.find((x) => x.id === logo.closest('[data-tema]')?.dataset.tema);
      if (t?.logo) logo.innerHTML = `<img src="${t.logo}" alt="${t.nombre}">`;
    });
  }

  function ventana(paso, tema, modo, i) {
    const pasos = [['Dónde va a vivir', 'Tu servidor'], ['Cómo leer los padrones', 'Con qué se leen'], ['Cómo se ve', 'Su apariencia'], ['Instalar', 'Lo hacemos solos']];
    const actual = paso.id === 'i-hola' || paso.id === 'i-donde' || paso.id === 'i-nube' ? 0 : paso.id === 'i-vision' ? 1 : paso.id === 'i-tema' ? 2 : 4;
    const estados = pasos.map(([a, b], n) => [a, b, n < actual ? 'hecho' : n === actual ? 'ahora' : '']);
    return `<div class="celda ancha" data-celda="${paso.id}">
      <div class="marco ventana-marco"><div class="ventana" ${paso.dinamica === 'selectorInstalador' ? `data-pie-banda="${Boolean(tema.claro.fondoPie)}" data-fondo="${tema.recetas.fondo === 'aurora' ? 'aurora' : 'liso'}"` : atributos(tema)} data-tema="${tema.id}" style="${variables(tema, modo, 'plan')}">
        <aside class="riel" ${paso.dinamica === 'selectorInstalador' ? `data-cabecera-riel="${tema.recetas.cabecera}"` : ''}><div class="marca-app">${logoUrna}<span>Urna Abierta</span></div>${plan(estados)}</aside>
        <section class="ventana-derecha">
          ${paso.ojo ? `<p class="ojo" style="margin:0">${paso.ojo}</p>` : ''}
          <h1 class="t1">${paso.titulo}</h1>
          ${paso.bajada ? `<p class="bajada">${paso.bajada}</p>` : ''}
          <div class="cuerpo-v">${paso.dinamica === 'selectorInstalador' ? selectorInstalador(tema) : paso.cuerpo}</div>
          <div class="pie-v">${boton(paso.boton[0], { ir: paso.boton[1], ic: 'flecha' })}</div>
        </section>
      </div></div>
      <p class="nota">${paso.nota}</p>
    </div>`;
  }

  function contraste(tema, modo) {
    const lum = (hex) => {
      const [r, g, b] = [1, 3, 5].map((n) => parseInt(hex.slice(n, n + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const a = lum(tema[modo].texto);
    const b = lum(tema[modo].fondo);
    return ((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toFixed(1);
  }

  function portada() {
    const f = FLUJOS.fiscal.pantallas;
    const elegir = (id) => f.find((p) => p.id === id);
    const tema = (id) => TEMAS.find((t) => t.id === id);
    const color = logoUrna.replace('<svg', '<svg class="logo-grande"');
    raiz.innerHTML = `<div class="portada">
      <div class="portada-texto">
        ${color}
        <h1>Urna Abierta</h1>
        <p>${estado.idioma === 'en' ? 'Watching over an election should not depend on having a huge political machine.' : 'Fiscalizar una elección no debería depender de tener un aparato enorme.'}</p>
      </div>
      <div class="portada-telefonos">
        ${telefono(elegir('f-plan'), tema('aula'), 'claro', { nota: false })}
        ${telefono(elegir('f-padron'), tema('tablero'), 'oscuro', { nota: false })}
        ${telefono(elegir('f-sobres'), tema('feria'), 'claro', { nota: false })}
      </div>
    </div>`;
  }

  function vitrinaTemas() {
    const padron = FLUJOS.fiscal.pantallas.find((p) => p.id === 'f-votaron');
    const publicos = TEMAS.filter((t) => !t.privado);
    raiz.innerHTML = `<div class="vitrina">${publicos.map((t, i) => `<figure>${telefono(padron, t, i % 2 ? 'oscuro' : 'claro', { nota: false })}<figcaption>${t.nombre}</figcaption></figure>`).join('')}</div>`;
  }

  function dibujar() {
    if (estado.vista === 'portada') return portada();
    if (estado.vista === 'vitrina') return vitrinaTemas();
    const tema = TEMAS.find((t) => t.id === estado.tema) ?? TEMAS[0];
    const modos = estado.modo === 'ambos' ? ['claro', 'oscuro'] : [estado.modo];
    const barra = `<header class="barra-galeria">
      <h1>Urna Abierta · propuesta de diseño, con personas inventadas</h1>
      <div class="fila-controles"><span>Ver</span>${VISTAS.map(([id, nombre]) => `<button class="chip" data-vista="${id}" aria-pressed="${estado.vista === id}">${nombre}</button>`).join('')}</div>
      ${estado.vista === 'comparar' ? '' : `<div class="fila-controles"><span>Tema</span>${TEMAS.map((t) => `<button class="chip" data-tema-boton="${t.id}" aria-pressed="${t.id === tema.id}"><i style="background:${t.claro.primario}"></i>${t.nombre}</button>`).join('')}</div>
      <div class="fila-controles"><span>Modo</span>${[['claro', 'Claro'], ['oscuro', 'Oscuro'], ['ambos', 'Los dos']].map(([id, n]) => `<button class="chip" data-modo-boton="${id}" aria-pressed="${estado.modo === id}">${n}</button>`).join('')}</div>`}
    </header>`;
    let contenido = '';
    if (estado.vista === 'comparar') {
      const f = FLUJOS.fiscal.pantallas;
      const elegir = (id) => f.find((p) => p.id === id);
      contenido = `<p class="intro"><strong>Los mismos pasos, en cada tema</strong>La misma app y las mismas pantallas: cambian la letra, el color, la forma y el modo de tachar. Elegí una pestaña de arriba para recorrer el trabajo de cada persona.</p>
      ${TEMAS.map((t) => `<section class="tema-fila">
        <div><h2>${t.nombre}</h2><p>${t.idea}</p><p class="contraste">Contraste del texto: ${contraste(t, 'claro')}:1 de día, ${contraste(t, 'oscuro')}:1 de noche</p></div>
        <div class="telefonos">
          ${telefono(elegir('f-plan'), t, 'claro', { mini: true, nota: false })}
          ${telefono(elegir('f-padron'), t, 'claro', { mini: true, nota: false })}
          ${telefono(elegir('f-votaron'), t, 'claro', { mini: true, nota: false })}
          ${telefono(elegir('f-plan'), t, 'oscuro', { mini: true, nota: false })}
          ${telefono(elegir('f-padron'), t, 'oscuro', { mini: true, nota: false })}
          ${telefono(elegir('f-votaron'), t, 'oscuro', { mini: true, nota: false })}
        </div></section>`).join('')}`;
    } else if (estado.vista === 'instalador') {
      contenido = `<p class="intro"><strong>${INSTALADOR.titulo}</strong>${INSTALADOR.explicacion}</p><div class="tira">${modos.map((m) => INSTALADOR.pantallas.map((p, i) => ventana(p, tema, m, i)).join('')).join('')}</div>`;
    } else {
      const flujo = FLUJOS[estado.vista];
      contenido = `<p class="intro"><strong>${flujo.titulo}</strong>${flujo.explicacion}</p><div class="tira">${modos.map((m) => flujo.pantallas.map((p) => telefono(p, tema, m)).join('')).join('')}</div>`;
    }
    raiz.innerHTML = `${barra}<div class="contenido">${contenido}</div>`;
    ponerLogos(raiz);
    location.hash = `vista=${estado.vista}&tema=${tema.id}&modo=${estado.modo}`;
  }

  function irA(id) {
    let celda = raiz.querySelector(`[data-celda="${id}"]`);
    if (!celda || estado.vista === 'comparar') {
      const vista = Object.entries(FLUJOS).find(([, f]) => f.pantallas.some((p) => p.id === id))?.[0] ?? (id.startsWith('i-') ? 'instalador' : null);
      if (!vista) return;
      estado.vista = vista;
      dibujar();
      celda = raiz.querySelector(`[data-celda="${id}"]`);
    }
    celda?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    celda?.classList.add('destello');
    setTimeout(() => celda?.classList.remove('destello'), 1200);
  }

  raiz.addEventListener('click', (evento) => {
    const de = (selector) => evento.target.closest(selector);
    const vista = de('[data-vista]');
    if (vista) { estado.vista = vista.dataset.vista; dibujar(); scrollTo(0, 0); return; }
    const tema = de('[data-tema-boton]') ?? de('[data-elegir-tema]');
    if (tema) { estado.tema = tema.dataset.temaBoton ?? tema.dataset.elegirTema; dibujar(); return; }
    const modo = de('[data-modo-boton]');
    if (modo) { estado.modo = modo.dataset.modoBoton; dibujar(); return; }
    const ir = de('[data-ir]');
    if (ir) { irA(ir.dataset.ir); return; }
    const volver = de('[data-atras]');
    if (volver) {
      const previa = volver.closest('[data-celda]')?.previousElementSibling;
      if (previa?.dataset.celda) irA(previa.dataset.celda);
      return;
    }
    const otro = de('[data-ver-otro]');
    if (otro) {
      const el = otro.closest('.pantalla');
      const i = TEMAS.findIndex((t) => t.id === el.dataset.tema);
      repintar(el, TEMAS[(i + 1) % TEMAS.length], el.dataset.modo);
      return;
    }
    const modoVista = de('[data-vista-modo]');
    if (modoVista) {
      const el = modoVista.closest('.pantalla');
      repintar(el, TEMAS.find((t) => t.id === el.dataset.tema), modoVista.dataset.vistaModo);
      return;
    }
    const usar = de('[data-usar-tema]');
    if (usar) {
      const el = usar.closest('.pantalla');
      estado.tema = el.dataset.tema;
      estado.modo = el.dataset.modo;
      dibujar();
      irA('f-plan');
      return;
    }
    const previa = de('[data-previa]');
    if (previa) {
      previa.closest('[data-grupo]').querySelectorAll('.opcion').forEach((o) => o.classList.remove('elegida'));
      previa.classList.add('elegida');
      const zona = previa.closest('.vista-doble').querySelector('[data-vistas]');
      zona.innerHTML = vistasPrevias(TEMAS.find((t) => t.id === previa.dataset.previa));
      ponerLogos(zona);
      return;
    }
    const opcion = de('[data-opcion]');
    if (opcion) {
      opcion.closest('[data-grupo]').querySelectorAll('.opcion').forEach((o) => o.classList.remove('elegida'));
      opcion.classList.add('elegida');
      return;
    }
    const tecla = de('[data-tecla]');
    if (tecla) {
      const salida = tecla.closest('.cuerpo').querySelector('[data-numero]');
      const valor = tecla.dataset.tecla;
      salida.textContent = valor === 'borrar' ? salida.textContent.slice(0, -1) : (salida.textContent + valor).slice(0, 4);
      return;
    }
    const fila = de('[data-fila]');
    if (fila && fila.closest('[data-lista]') && !fila.classList.contains('tachada')) {
      fila.classList.add('tachada');
      const pantalla = fila.closest('.pantalla');
      const contador = pantalla.querySelector('[data-faltan]');
      contador.textContent = Number(contador.textContent) - 1;
      const barra = pantalla.querySelector('[data-deshacer]');
      barra.hidden = false;
      barra.querySelector('span').textContent = `Tachaste a ${fila.querySelector('.nombre-t').textContent.split(',')[0]}`;
      barra.fila = fila;
      fila.classList.add('yendose');
      clearTimeout(barra.reloj);
      barra.reloj = setTimeout(() => { barra.hidden = true; }, 5000);
      return;
    }
    const deshacer = de('[data-deshacer] button');
    if (deshacer) {
      const barra = deshacer.parentElement;
      barra.fila?.classList.remove('tachada', 'yendose');
      const contador = barra.closest('.pantalla').querySelector('[data-faltan]');
      contador.textContent = Number(contador.textContent) + 1;
      barra.hidden = true;
    }
  });

  dibujar();
})();
