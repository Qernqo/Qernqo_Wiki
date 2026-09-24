// Utilidades compartidas del frontend.

// Crea elementos DOM de forma segura (sin innerHTML con datos del usuario).
export function h(tag, attrs = {}, ...hijos) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v; // solo con contenido propio (íconos)
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const hijo of hijos.flat(Infinity)) {
    if (hijo == null || hijo === false) continue;
    el.append(hijo instanceof Node ? hijo : String(hijo));
  }
  return el;
}

// Íconos de línea (estilo del sitio de referencia).
const ICONOS = {
  usuario: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
  buscar: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  mas: '<path d="M12 5v14M5 12h14"/>',
  basura: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  lapiz: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/>',
  carpeta: '<path d="M3 6h6l2 2h10v11H3z"/>',
  mover: '<path d="M3 6h6l2 2h10v11H3z"/><path d="m11 14h6m-2-2 2 2-2 2"/>',
  pdf: '<path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6"/>',
  descargar: '<path d="M12 3v12m-5-5 5 5 5-5M4 21h16"/>',
  arrastrar: '<circle cx="9" cy="6" r="1.2"/><circle cx="15" cy="6" r="1.2"/><circle cx="9" cy="12" r="1.2"/><circle cx="15" cy="12" r="1.2"/><circle cx="9" cy="18" r="1.2"/><circle cx="15" cy="18" r="1.2"/>',
  imagen: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 17-5-5-9 8"/>',
  cerrar: '<path d="M6 6l12 12M18 6 6 18"/>',
  flecha: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  reloj: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  restaurar: '<path d="M4 12a8 8 0 1 0 3-6.3M4 4v4h4"/>',
  libro: '<path d="M4 5a2 2 0 0 1 2-2h14v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5"/>',
  ficha: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  salir: '<path d="M15 4h4v16h-4M10 16l4-4-4-4M14 12H4"/>',
  ver: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  atras: '<path d="M19 12H5m5-5-5 5 5 5"/>',
  tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.3"/>',
};

export function icono(nombre, clase = '') {
  const span = document.createElement('span');
  span.className = `icono ${clase}`;
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONOS[nombre] || ''}</svg>`;
  return span;
}

// ---------- API ----------

export class ErrorApi extends Error {
  constructor(estado, mensaje) {
    super(mensaje);
    this.estado = estado;
  }
}

export async function api(metodo, ruta, cuerpo) {
  const opciones = { method: metodo, credentials: 'same-origin', headers: {} };
  if (metodo !== 'GET') {
    opciones.headers['Content-Type'] = 'application/json';
    opciones.headers['X-Wiki'] = '1';
    opciones.body = JSON.stringify(cuerpo || {});
  }
  let r;
  try {
    r = await fetch(ruta, opciones);
  } catch {
    throw new ErrorApi(0, 'No se pudo conectar con el servidor');
  }
  let datos = {};
  try {
    datos = await r.json();
  } catch {
    /* respuesta vacía */
  }
  if (!r.ok) throw new ErrorApi(r.status, datos.error || `Error ${r.status}`);
  return datos;
}

// ---------- texto y fechas ----------

export const normalizar = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

export function hoyISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function fechaLarga(iso) {
  if (!iso) return '';
  const [a, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(a, m - 1, d).toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function fechaCorta(iso) {
  if (!iso) return '';
  const [a, m, d] = iso.slice(0, 10).split('-');
  return `${d}-${m}-${a}`;
}

export function fechaHora(iso) {
  return new Date(iso).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' });
}

// ---------- versiones X.Y (Y de 0 a 9) ----------

export function parseVersion(v) {
  const m = /^(\d{1,3})\.(\d)$/.exec(String(v).trim());
  return m ? [Number(m[1]), Number(m[2])] : null;
}
export function compararVersion(a, b) {
  const [x, y] = [parseVersion(a), parseVersion(b)];
  return x[0] - y[0] || x[1] - y[1];
}
export function siguienteVersion(v) {
  const p = parseVersion(v);
  if (!p) return '1.0';
  return p[1] < 9 ? `${p[0]}.${p[1] + 1}` : `${p[0] + 1}.0`;
}

// ---------- avisos y modales ----------

export function aviso(mensaje, tipo = 'ok') {
  let zona = document.getElementById('avisos');
  if (!zona) {
    zona = h('div', { id: 'avisos', role: 'status', 'aria-live': 'polite' });
    document.body.append(zona);
  }
  const el = h('div', { class: `aviso aviso-${tipo}` }, mensaje);
  zona.append(el);
  setTimeout(() => el.classList.add('salir'), 3800);
  setTimeout(() => el.remove(), 4300);
}

export function modal({ titulo, contenido, botones = [], ancho = '' }) {
  return new Promise((resolve) => {
    const anterior = document.activeElement;
    const cerrar = (valor) => {
      fondo.remove();
      document.removeEventListener('keydown', teclado);
      anterior && anterior.focus && anterior.focus();
      resolve(valor);
    };
    const teclado = (e) => {
      if (e.key === 'Escape') cerrar(null);
    };
    const pie = h(
      'div',
      { class: 'modal-pie' },
      botones.map((b) =>
        h(
          'button',
          {
            type: b.submit ? 'submit' : 'button',
            class: `btn ${b.clase || 'btn-secundario'}`,
            onclick: b.submit ? null : async () => cerrar(b.accion ? await b.accion() : b.valor),
          },
          b.texto,
        ),
      ),
    );
    const caja = h(
      'form',
      {
        class: `modal ${ancho}`,
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': titulo,
        onsubmit: async (e) => {
          e.preventDefault();
          const b = botones.find((x) => x.submit);
          if (!b) return;
          const r = b.accion ? await b.accion() : b.valor;
          if (r !== undefined) cerrar(r);
        },
      },
      h(
        'div',
        { class: 'modal-cabecera' },
        h('h2', {}, titulo),
        h('button', { type: 'button', class: 'btn-icono', 'aria-label': 'Cerrar', onclick: () => cerrar(null) }, icono('cerrar')),
      ),
      h('div', { class: 'modal-cuerpo' }, contenido),
      botones.length ? pie : null,
    );
    const fondo = h('div', { class: 'modal-fondo', onmousedown: (e) => e.target === fondo && cerrar(null) }, caja);
    document.body.append(fondo);
    document.addEventListener('keydown', teclado);
    const foco = caja.querySelector('input, select, textarea') || caja.querySelector('.modal-pie .btn');
    foco && foco.focus();
  });
}

export function confirmar(titulo, mensaje, textoBoton = 'Confirmar', peligro = false) {
  return modal({
    titulo,
    contenido: h('p', {}, mensaje),
    botones: [
      { texto: 'Cancelar', valor: false },
      { texto: textoBoton, valor: true, clase: peligro ? 'btn-peligro' : 'btn-primario' },
    ],
  });
}

export function pedirTexto(titulo, etiqueta, inicial = '') {
  const input = h('input', { type: 'text', value: inicial, maxlength: 80, required: true, class: 'campo' });
  return modal({
    titulo,
    contenido: h('label', { class: 'etiqueta' }, etiqueta, input),
    botones: [
      { texto: 'Cancelar', valor: null },
      { texto: 'Aceptar', submit: true, clase: 'btn-primario', accion: () => input.value.trim() || undefined },
    ],
  });
}

// Lee un archivo/URL como dataURL.
export function blobADataUrl(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });
}

// Reemplaza el contenido de un elemento ignorando null/false
// (replaceChildren nativo los convertiría en el texto "null").
export function poner(el, ...hijos) {
  el.replaceChildren(...hijos.flat(Infinity).filter((x) => x != null && x !== false));
}

// URL de una imagen guardada en una versión (ruta relativa como "img/paso01-1.jpg").
export function urlImagen(base, ruta) {
  if (/^(blob:|data:|https?:)/.test(ruta)) return ruta;
  return base + ruta.split('/').map(encodeURIComponent).join('/');
}
