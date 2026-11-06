// Lets a visitor try each theme on this page, in light or dark: the same data and the same rules the app uses (temas.js
// and aplicar-tema.js, copied from apps/web/src/lib). The choice stays in this browser only; nothing is sent anywhere.
(() => {
  const raiz = document.documentElement;
  const sistema = window.matchMedia('(prefers-color-scheme: dark)');
  const temas = window.TEMAS || [];
  // Feria gives each task its colour: the sections take them in this order.
  const BANDAS = ['plan', 'tachar', 'sobres', 'escrutinio', 'aviso'];
  const leer = (clave) => {
    try {
      return localStorage.getItem(clave);
    } catch {
      return null;
    }
  };
  const guardar = (clave, valor) => {
    try {
      localStorage.setItem(clave, valor);
    } catch {
      // Private windows may refuse: the choice still holds until the page closes.
    }
  };
  let elegido = leer('urna-tema') || 'aula';
  let modoElegido = leer('urna-modo'); // 'claro', 'oscuro', or nothing to follow the system

  function aplicar() {
    const tema = temas.find((t) => t.id === elegido) || temas[0];
    if (!tema) return;
    const modo = modoElegido || (sistema.matches ? 'oscuro' : 'claro');
    const c = tema[modo];
    const poner = (nombre, valor) => raiz.style.setProperty(nombre, valor);
    // One property at a time: the page's security policy allows that, and never a style attribute.
    raiz.removeAttribute('style');
    for (const par of window.URNA_TEMA.variables(tema, modo).split(';')) {
      const corte = par.indexOf(':');
      if (corte > 0) poner(par.slice(0, corte), par.slice(corte + 1));
    }
    // The cover panel, as the design gallery draws it next to the phones.
    poner('--panel', modo === 'claro' ? c.primario : c.superficie2);
    poner('--sobre-panel', modo === 'claro' ? c.sobrePrimario : c.texto);
    poner('color-scheme', modo === 'claro' ? 'light' : 'dark');
    BANDAS.forEach((banda, i) => {
      const par = c.bandas?.[banda];
      if (!par) return;
      poner(`--banda-${i + 1}`, par[0]);
      poner(`--sobre-banda-${i + 1}`, par[1]);
    });
    for (const [nombre, valor] of Object.entries(window.URNA_TEMA.recetas(tema))) raiz.setAttribute(nombre, valor);
    raiz.dataset.tema = tema.id;
    raiz.dataset.modo = modo;
    for (const imagen of document.querySelectorAll('img[data-telefonos]')) {
      imagen.src = `${imagen.dataset.telefonos}telefonos-${tema.id}-${modo}.webp`;
    }
    for (const boton of document.querySelectorAll('[data-tema-elegir]')) {
      boton.setAttribute('aria-pressed', String(boton.dataset.temaElegir === tema.id));
    }
    for (const boton of document.querySelectorAll('[data-modo-elegir]')) {
      boton.setAttribute('aria-pressed', String(boton.dataset.modoElegir === modo));
    }
  }

  document.addEventListener('click', (evento) => {
    const tema = evento.target.closest('[data-tema-elegir]');
    const modo = evento.target.closest('[data-modo-elegir]');
    if (tema) {
      elegido = tema.dataset.temaElegir;
      guardar('urna-tema', elegido);
    } else if (modo) {
      modoElegido = modo.dataset.modoElegir;
      guardar('urna-modo', modoElegido);
    } else {
      return;
    }
    aplicar();
  });
  sistema.addEventListener('change', aplicar);
  aplicar();
})();
