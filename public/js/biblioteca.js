// Vista Biblioteca: árbol de categorías, buscador con tolerancia a errores
// y filtros combinables (categoría, tags, autor, rango de fechas).
/* global MiniSearch */
import { h, icono, api, aviso, modal, confirmar, pedirTexto, normalizar, fechaLarga, fechaHora, poner } from './util.js';
import { estado, puedeEditar, esAdmin, cargarBiblioteca, categoriasPlanas, textoRuta } from './estado.js';

// Filtros persistentes mientras la página esté abierta.
const filtros = { q: '', categoria: [], tags: new Set(), autor: '', desde: '', hasta: '', orden: 'relevancia' };
const expandidas = new Set();
let motor = null;
let todosLosTags = [];
let cont = null;

// ---------- índice de búsqueda ----------

function construirMotor(fichas) {
  motor = new MiniSearch({
    idField: 'id',
    fields: ['nombre', 'tags', 'descripcion', 'texto', 'autor', 'categoria', 'version'],
    extractField: (doc, campo) => {
      if (campo === 'tags') return doc.tags.join(' ');
      if (campo === 'categoria') return doc.categoria.join(' ');
      return doc[campo];
    },
    processTerm: (t) => normalizar(t) || null,
    searchOptions: {
      boost: { nombre: 4, tags: 3, descripcion: 1.5, categoria: 1.5, autor: 1.2 },
      prefix: (t) => t.length >= 2,
      fuzzy: (t) => (t.length >= 4 ? 0.25 : false),
      combineWith: 'AND',
    },
  });
  motor.addAll(fichas);

  const cuenta = new Map();
  fichas.forEach((f) => f.tags.forEach((t) => cuenta.set(t, (cuenta.get(t) || 0) + 1)));
  todosLosTags = [...cuenta.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'es'));
}

function buscar() {
  const fichas = estado.biblioteca.fichas;
  const porId = new Map(fichas.map((f) => [f.id, f]));
  let lista;
  let parcial = false;
  const puntaje = new Map();
  const q = filtros.q.trim();
  if (q) {
    let r = motor.search(q);
    if (!r.length && q.split(/\s+/).length > 1) {
      r = motor.search(q, { combineWith: 'OR' });
      parcial = r.length > 0;
    }
    r.forEach((x) => puntaje.set(x.id, x.score));
    lista = r.map((x) => porId.get(x.id)).filter(Boolean);
  } else {
    lista = [...fichas];
  }

  const cat = filtros.categoria;
  lista = lista.filter(
    (f) =>
      cat.every((s, i) => f.categoria[i] === s) &&
      [...filtros.tags].every((t) => f.tags.includes(t)) &&
      (!filtros.autor || f.autor === filtros.autor) &&
      (!filtros.desde || f.fecha >= filtros.desde) &&
      (!filtros.hasta || f.fecha <= filtros.hasta),
  );

  const orden = {
    relevancia: (a, b) => (q ? puntaje.get(b.id) - puntaje.get(a.id) : b.actualizado.localeCompare(a.actualizado)),
    recientes: (a, b) => b.fecha.localeCompare(a.fecha) || b.actualizado.localeCompare(a.actualizado),
    nombre: (a, b) => a.nombre.localeCompare(b.nombre, 'es'),
  }[filtros.orden];
  lista.sort(orden);
  return { lista, parcial };
}

// Fragmento del texto de los pasos donde aparece la búsqueda.
// Resumen de la tarjeta: la descripción (o el texto de los pasos) y, si hay
// búsqueda, el fragmento donde aparece el término.
function extracto(ficha) {
  const plano = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const fuentes = [plano(ficha.descripcion), plano(ficha.texto)].filter(Boolean);
  if (!fuentes.length) return '';
  const terminos = normalizar(filtros.q).split(/\s+/).filter((t) => t.length >= 3);
  for (const t of terminos) {
    for (const texto of fuentes) {
      const i = normalizar(texto).indexOf(t);
      if (i < 0) continue;
      const ini = Math.max(0, i - 60);
      const fin = Math.min(texto.length, i + t.length + 90);
      return h(
        'span',
        {},
        ini > 0 ? '…' : '',
        texto.slice(ini, i),
        h('mark', {}, texto.slice(i, i + t.length)),
        texto.slice(i + t.length, fin),
        fin < texto.length ? '…' : '',
      );
    }
  }
  const texto = fuentes[0];
  return texto.length > 160 ? texto.slice(0, 160) + '…' : texto;
}

// ---------- acciones ----------

async function recargar() {
  await cargarBiblioteca();
  construirMotor(estado.biblioteca.fichas);
  // si la categoría filtrada ya no existe, se quita el filtro
  if (filtros.categoria.length && !categoriasPlanas().some((c) => c.texto === textoRuta(filtros.categoria))) {
    filtros.categoria = [];
  }
  pintar();
}

async function ejecutar(fn, mensaje) {
  try {
    await fn();
    if (mensaje) aviso(mensaje);
    await recargar();
  } catch (e) {
    aviso(e.message, 'error');
  }
}

async function nuevaCategoria(padre) {
  const nombre = await pedirTexto(padre.length ? `Nueva subcategoría en "${textoRuta(padre)}"` : 'Nueva categoría', 'Nombre');
  if (!nombre) return;
  if (padre.length) expandidas.add(textoRuta(padre));
  ejecutar(() => api('POST', '/api/categorias', { padre, nombre }), 'Categoría creada');
}

async function renombrarCategoria(ruta) {
  const nombre = await pedirTexto('Renombrar categoría', 'Nuevo nombre', ruta.at(-1));
  if (!nombre || nombre === ruta.at(-1)) return;
  ejecutar(async () => {
    const r = await api('PUT', '/api/categorias', { ruta, nombre });
    if (textoRuta(filtros.categoria).startsWith(textoRuta(ruta))) filtros.categoria = r.ruta;
  }, 'Categoría renombrada');
}

async function eliminarCategoria(ruta) {
  if (!(await confirmar('Eliminar categoría', `¿Eliminar la categoría "${textoRuta(ruta)}"? Debe estar vacía.`, 'Eliminar', true))) return;
  ejecutar(() => api('DELETE', '/api/categorias', { ruta }), 'Categoría eliminada');
}

async function moverFicha(ficha) {
  const select = h(
    'select',
    { class: 'campo' },
    categoriasPlanas().map((c) =>
      h('option', { value: JSON.stringify(c.ruta), selected: textoRuta(ficha.categoria) === c.texto }, `${'   '.repeat(c.nivel)}${c.ruta.at(-1)}`),
    ),
  );
  const destino = await modal({
    titulo: 'Mover procedimiento',
    contenido: [h('p', {}, h('strong', {}, ficha.nombre)), h('label', { class: 'etiqueta' }, 'Categoría de destino', select)],
    botones: [
      { texto: 'Cancelar', valor: null },
      { texto: 'Mover', submit: true, clase: 'btn-primario', accion: () => JSON.parse(select.value) },
    ],
  });
  if (!destino) return;
  ejecutar(() => api('POST', `/api/fichas/${ficha.id}/mover`, { categoria: destino }), 'Procedimiento movido');
}

async function eliminarFicha(ficha) {
  const ok = await confirmar(
    'Eliminar procedimiento',
    `"${ficha.nombre}" y todas sus versiones se enviarán a la papelera.`,
    'Enviar a la papelera',
    true,
  );
  if (ok) ejecutar(() => api('DELETE', `/api/fichas/${ficha.id}`), 'Procedimiento enviado a la papelera');
}

async function historial(ficha) {
  let detalle;
  try {
    detalle = await api('GET', `/api/fichas/${ficha.id}`);
  } catch (e) {
    aviso(e.message, 'error');
    return;
  }
  const filas = detalle.versiones.map((v) =>
    h(
      'tr',
      {},
      h('td', {}, h('strong', {}, `v${v.version}`), v.version === detalle.versionActual ? h('span', { class: 'insignia' }, 'Vigente') : null),
      h('td', {}, fechaLarga(v.fecha)),
      h('td', {}, v.autor),
      h('td', { class: 'texto-suave' }, `${fechaHora(v.guardado)} · ${v.usuario}`),
      h(
        'td',
        { class: 'acciones-tabla' },
        h(
          'a',
          {
            class: 'btn btn-secundario btn-chico',
            href: `#/procedimiento/${ficha.id}/${v.version}`,
            onclick: () => document.querySelector('.modal-fondo .modal-cabecera .btn-icono')?.click(),
          },
          icono('ver'),
          'Ver',
        ),
        h('a', { class: 'btn btn-secundario btn-chico', href: v.url, download: '' }, icono('descargar'), 'PDF'),
        esAdmin() && detalle.versiones.length > 1
          ? h(
              'button',
              {
                class: 'btn btn-peligro-suave btn-chico',
                type: 'button',
                onclick: async () => {
                  if (await confirmar('Eliminar versión', `¿Enviar la versión ${v.version} a la papelera?`, 'Eliminar', true)) {
                    document.querySelector('.modal-fondo .modal-cabecera .btn-icono')?.click();
                    ejecutar(() => api('DELETE', `/api/fichas/${ficha.id}/versiones/${v.version}`), `Versión ${v.version} enviada a la papelera`);
                  }
                },
              },
              icono('basura'),
            )
          : null,
      ),
    ),
  );
  modal({
    titulo: 'Historial de versiones',
    ancho: 'modal-ancho',
    contenido: [
      h('p', { class: 'fuerte' }, detalle.datos.nombre),
      h('p', { class: 'texto-suave' }, textoRuta(detalle.categoria)),
      h(
        'div',
        { class: 'tabla-envoltura' },
        h(
          'table',
          { class: 'tabla' },
          h('thead', {}, h('tr', {}, ['Versión', 'Fecha', 'Elaborado por', 'Guardado', ''].map((t) => h('th', {}, t)))),
          h('tbody', {}, filas),
        ),
      ),
    ],
    botones: [{ texto: 'Cerrar', valor: null }],
  });
}

// ---------- árbol de categorías ----------

function nodoArbol(n) {
  const clave = textoRuta(n.ruta);
  const abierto = expandidas.has(clave);
  const seleccionado = textoRuta(filtros.categoria) === clave;
  const acciones = h(
    'span',
    { class: 'arbol-acciones' },
    puedeEditar() && n.ruta.length < estado.biblioteca.maxNiveles
      ? h('button', { class: 'btn-icono btn-mini', title: 'Agregar subcategoría', onclick: () => nuevaCategoria(n.ruta) }, icono('mas'))
      : null,
    puedeEditar() ? h('button', { class: 'btn-icono btn-mini', title: 'Renombrar', onclick: () => renombrarCategoria(n.ruta) }, icono('lapiz')) : null,
    esAdmin() && n.total === 0 && !n.hijos.length
      ? h('button', { class: 'btn-icono btn-mini peligro', title: 'Eliminar categoría vacía', onclick: () => eliminarCategoria(n.ruta) }, icono('basura'))
      : null,
  );
  return h(
    'li',
    {},
    h(
      'div',
      { class: `arbol-fila ${seleccionado ? 'seleccionado' : ''}` },
      h(
        'button',
        {
          class: `arbol-toggle ${abierto ? 'abierto' : ''}`,
          'aria-label': abierto ? 'Contraer' : 'Expandir',
          style: n.hijos.length ? null : 'visibility:hidden',
          onclick: () => {
            abierto ? expandidas.delete(clave) : expandidas.add(clave);
            pintarArbol();
          },
        },
        icono('chevron'),
      ),
      h(
        'button',
        {
          class: 'arbol-nombre',
          onclick: () => {
            filtros.categoria = seleccionado ? [] : n.ruta;
            expandidas.add(clave);
            pintarArbol();
            pintarResultados();
          },
        },
        h('span', {}, n.nombre),
        h('span', { class: 'contador' }, n.total),
      ),
      acciones,
    ),
    abierto && n.hijos.length ? h('ul', {}, n.hijos.map(nodoArbol)) : null,
  );
}

function pintarArbol() {
  const zona = cont.querySelector('#arbol');
  const total = estado.biblioteca.fichas.length;
  poner(zona, 
    h(
      'div',
      { class: 'tarjeta-cabecera' },
      h('h2', {}, 'Categorías'),
      puedeEditar() ? h('button', { class: 'btn btn-secundario btn-chico', onclick: () => nuevaCategoria([]) }, icono('mas'), 'Nueva') : null,
    ),
    h(
      'button',
      {
        class: `arbol-todas ${filtros.categoria.length ? '' : 'seleccionado'}`,
        onclick: () => {
          filtros.categoria = [];
          pintarArbol();
          pintarResultados();
        },
      },
      icono('libro'),
      h('span', {}, 'Todos los procedimientos'),
      h('span', { class: 'contador' }, total),
    ),
    estado.biblioteca.arbol.length
      ? h('ul', { class: 'arbol' }, estado.biblioteca.arbol.map(nodoArbol))
      : h('p', { class: 'texto-suave' }, puedeEditar() ? 'Crea la primera categoría para empezar.' : 'Aún no hay categorías.'),
  );
}

// ---------- filtros y resultados ----------

function pintarTags() {
  const zona = cont.querySelector('#tags-filtro');
  const verTodos = zona.dataset.todos === '1';
  const visibles = verTodos ? todosLosTags : todosLosTags.slice(0, 18);
  poner(zona, 
    ...visibles.map(([t, n]) =>
      h(
        'button',
        {
          class: `chip ${filtros.tags.has(t) ? 'chip-activo' : ''}`,
          onclick: () => {
            filtros.tags.has(t) ? filtros.tags.delete(t) : filtros.tags.add(t);
            pintarTags();
            pintarResultados();
          },
        },
        t,
        h('span', { class: 'chip-num' }, n),
      ),
    ),
    todosLosTags.length > 18
      ? h(
          'button',
          {
            class: 'enlace',
            onclick: () => {
              zona.dataset.todos = verTodos ? '0' : '1';
              pintarTags();
            },
          },
          verTodos ? 'Ver menos' : `Ver todos (${todosLosTags.length})`,
        )
      : null,
    todosLosTags.length ? null : h('span', { class: 'texto-suave' }, 'Sin tags todavía'),
  );
}

function tarjetaFicha(f) {
  return h(
    'article',
    { class: 'ficha' },
    h('div', { class: 'ficha-icono' }, icono('ficha')),
    h(
      'div',
      { class: 'ficha-cuerpo' },
      h('div', { class: 'ficha-ruta' }, f.categoria.join(' › ')),
      h(
        'h3',
        { class: 'ficha-titulo' },
        h('a', { href: `#/procedimiento/${f.id}` }, f.nombre),
        h(
          'button',
          { class: 'version', title: `Historial de versiones (${f.versiones})`, onclick: () => historial(f) },
          `v${f.version}`,
          h('span', { class: 'version-mas' }, '…'),
        ),
      ),
      h('p', { class: 'ficha-extracto' }, extracto(f)),
      h(
        'div',
        { class: 'ficha-meta' },
        h('span', {}, icono('reloj'), fechaLarga(f.fecha)),
        h('span', {}, icono('usuario'), f.autor),
        h('span', {}, `${f.pasos} paso${f.pasos === 1 ? '' : 's'}`),
      ),
      f.tags.length
        ? h(
            'div',
            { class: 'ficha-tags' },
            f.tags.map((t) =>
              h(
                'button',
                {
                  class: `chip chip-chico ${filtros.tags.has(t) ? 'chip-activo' : ''}`,
                  onclick: () => {
                    filtros.tags.add(t);
                    pintarTags();
                    pintarResultados();
                  },
                },
                t,
              ),
            ),
          )
        : null,
    ),
    h(
      'div',
      { class: 'ficha-acciones' },
      h('a', { class: 'btn btn-primario btn-chico', href: `#/procedimiento/${f.id}` }, icono('ver'), 'Ver'),
      h('a', { class: 'btn btn-secundario btn-chico', href: f.pdf, download: '' }, icono('descargar'), 'Descargar'),
      puedeEditar() ? h('a', { class: 'btn btn-secundario btn-chico', href: `#/generador/${f.id}` }, icono('lapiz'), 'Editar') : null,
      puedeEditar() ? h('button', { class: 'btn btn-secundario btn-chico', onclick: () => moverFicha(f) }, icono('mover'), 'Mover') : null,
      esAdmin() ? h('button', { class: 'btn btn-peligro-suave btn-chico', onclick: () => eliminarFicha(f) }, icono('basura'), 'Eliminar') : null,
    ),
  );
}

function pintarResultados() {
  if (!cont.querySelector('#resultados')) return; // la vista ya no está en pantalla
  const { lista, parcial } = buscar();
  const activos = [];
  const quitar = (fn) => () => {
    fn();
    pintarArbol();
    pintarTags();
    sincronizarControles();
    pintarResultados();
  };
  if (filtros.categoria.length) activos.push(['Categoría: ' + textoRuta(filtros.categoria), quitar(() => (filtros.categoria = []))]);
  filtros.tags.forEach((t) => activos.push([`Tag: ${t}`, quitar(() => filtros.tags.delete(t))]));
  if (filtros.autor) activos.push([`Autor: ${filtros.autor}`, quitar(() => (filtros.autor = ''))]);
  if (filtros.desde) activos.push([`Desde: ${fechaLarga(filtros.desde)}`, quitar(() => (filtros.desde = ''))]);
  if (filtros.hasta) activos.push([`Hasta: ${fechaLarga(filtros.hasta)}`, quitar(() => (filtros.hasta = ''))]);

  poner(cont.querySelector('#activos'), 
    ...activos.map(([texto, fn]) => h('button', { class: 'chip chip-activo', onclick: fn, title: 'Quitar filtro' }, texto, icono('cerrar', 'icono-chico'))),
    activos.length > 1 || (activos.length && filtros.q)
      ? h(
          'button',
          {
            class: 'enlace',
            onclick: quitar(() => {
              Object.assign(filtros, { q: '', categoria: [], autor: '', desde: '', hasta: '' });
              filtros.tags.clear();
            }),
          },
          'Limpiar todo',
        )
      : null,
  );

  const n = lista.length;
  cont.querySelector('#conteo').textContent = `${n} procedimiento${n === 1 ? '' : 's'}${filtros.q ? ` para "${filtros.q}"` : ''}`;
  cont.querySelector('#aviso-parcial').hidden = !parcial;
  const zona = cont.querySelector('#resultados');
  if (!n) {
    poner(zona, 
      h(
        'div',
        { class: 'vacio' },
        h('p', {}, estado.biblioteca.fichas.length ? 'No se encontraron procedimientos con esos criterios.' : 'La biblioteca aún no tiene procedimientos.'),
        puedeEditar() && !estado.biblioteca.fichas.length ? h('a', { class: 'btn btn-primario', href: '#/generador' }, 'Crear el primer procedimiento') : null,
      ),
    );
    return;
  }
  poner(zona, ...lista.map(tarjetaFicha));
}

function sincronizarControles() {
  cont.querySelector('#q').value = filtros.q;
  cont.querySelector('#f-autor').value = filtros.autor;
  cont.querySelector('#f-desde').value = filtros.desde;
  cont.querySelector('#f-hasta').value = filtros.hasta;
  cont.querySelector('#f-orden').value = filtros.orden;
}

function pintar() {
  const autores = [...new Set(estado.biblioteca.fichas.map((f) => f.autor))].sort((a, b) => a.localeCompare(b, 'es'));
  let espera;
  const q = h('input', {
    id: 'q',
    type: 'search',
    class: 'buscador-input',
    placeholder: 'Buscar por nombre, tag, contenido de los pasos, autor…',
    'aria-label': 'Buscar procedimientos',
    autocomplete: 'off',
    oninput: (e) => {
      clearTimeout(espera);
      espera = setTimeout(() => {
        filtros.q = e.target.value;
        pintarResultados();
      }, 120);
    },
  });
  const cambio = (campo) => (e) => {
    filtros[campo] = e.target.value;
    pintarResultados();
  };

  poner(cont, 
    h(
      'section',
      { class: 'hero' },
      h(
        'div',
        { class: 'wrap' },
        h('h1', {}, 'Biblioteca de Procedimientos TI'),
        h('p', {}, 'Manuales y procedimientos de la Unidad de Soporte TI.'),
        h('div', { class: 'buscador' }, icono('buscar'), q),
        h('p', { class: 'hero-ayuda' }, 'Tolera errores de tipeo y tildes. Combina la búsqueda con los filtros de categoría, tags, autor y fecha.'),
      ),
    ),
    h(
      'div',
      { class: 'wrap biblio' },
      h('aside', { class: 'tarjeta panel-arbol', id: 'arbol' }),
      h(
        'div',
        { class: 'biblio-principal' },
        h(
          'div',
          { class: 'tarjeta filtros' },
          h(
            'div',
            { class: 'filtros-fila' },
            h(
              'label',
              { class: 'etiqueta' },
              'Autor',
              h('select', { id: 'f-autor', class: 'campo', onchange: cambio('autor') }, h('option', { value: '' }, 'Todos'), autores.map((a) => h('option', { value: a }, a))),
            ),
            h('label', { class: 'etiqueta' }, 'Desde', h('input', { id: 'f-desde', type: 'date', class: 'campo', onchange: cambio('desde') })),
            h('label', { class: 'etiqueta' }, 'Hasta', h('input', { id: 'f-hasta', type: 'date', class: 'campo', onchange: cambio('hasta') })),
            h(
              'label',
              { class: 'etiqueta' },
              'Ordenar por',
              h(
                'select',
                { id: 'f-orden', class: 'campo', onchange: cambio('orden') },
                h('option', { value: 'relevancia' }, 'Relevancia'),
                h('option', { value: 'recientes' }, 'Más recientes'),
                h('option', { value: 'nombre' }, 'Nombre (A–Z)'),
              ),
            ),
          ),
          h('div', { class: 'filtros-tags' }, h('span', { class: 'etiqueta-inline' }, icono('tag'), 'Tags'), h('div', { id: 'tags-filtro', class: 'chips' })),
        ),
        h('div', { class: 'resultados-cabecera' }, h('strong', { id: 'conteo' }), h('div', { id: 'activos', class: 'chips' })),
        h('p', { id: 'aviso-parcial', class: 'aviso-parcial', hidden: true }, 'Ningún procedimiento contiene todas las palabras; se muestran coincidencias parciales.'),
        h('div', { id: 'resultados', class: 'resultados' }),
      ),
    ),
  );
  sincronizarControles();
  pintarArbol();
  pintarTags();
  pintarResultados();
}

export async function vistaBiblioteca(contenedor) {
  cont = contenedor;
  await cargarBiblioteca();
  construirMotor(estado.biblioteca.fichas);
  pintar();
}
