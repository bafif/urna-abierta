// Lets a visitor try each theme on this page: the same data and the same rules the app uses (temas.js and
// aplicar-tema.js, copied from apps/web/src/lib). The choice stays in this browser only; nothing is sent anywhere.
(() => {
  const CLAVE = 'urna-tema';
  const raiz = document.documentElement;
  const oscuro = window.matchMedia('(prefers-color-scheme: dark)');
  const temas = window.TEMAS || [];
  let elegido = null;
  try {
    elegido = localStorage.getItem(CLAVE);
  } catch {
    elegido = null;
  }

  function aplicar(id) {
    const tema = temas.find((t) => t.id === id) || temas[0];
    if (!tema) return;
    const modo = oscuro.matches ? 'oscuro' : 'claro';
    // One property at a time: the page's security policy allows that, and never a style attribute.
    for (const par of window.URNA_TEMA.variables(tema, modo).split(';')) {
      const corte = par.indexOf(':');
      if (corte > 0) raiz.style.setProperty(par.slice(0, corte), par.slice(corte + 1));
    }
    for (const [nombre, valor] of Object.entries(window.URNA_TEMA.recetas(tema))) raiz.setAttribute(nombre, valor);
    raiz.setAttribute('data-tema', tema.id);
    for (const boton of document.querySelectorAll('[data-tema-elegir]')) {
      boton.setAttribute('aria-pressed', String(boton.dataset.temaElegir === tema.id));
    }
  }

  document.addEventListener('click', (evento) => {
    const boton = evento.target.closest('[data-tema-elegir]');
    if (!boton) return;
    elegido = boton.dataset.temaElegir;
    try {
      localStorage.setItem(CLAVE, elegido);
    } catch {
      // Private windows may refuse: the theme still changes until the page closes.
    }
    aplicar(elegido);
  });
  oscuro.addEventListener('change', () => aplicar(elegido || 'aula'));
  aplicar(elegido || 'aula');
})();
