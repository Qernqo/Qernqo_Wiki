// Punto de entrada: cabecera, sesión, rutas y papelera.
import { h, icono, api, aviso, modal, confirmar, fechaHora, poner } from './util.js';
import { estado, esAdmin, puedeEditar, cargarBiblioteca, categoriasPlanas, textoRuta } from './estado.js';
import { vistaBiblioteca } from './biblioteca.js';
import { vistaGenerador } from './generador.js';
import { vistaProcedimiento } from './vista.js';

const principal = document.getElementById('principal');

// ---------- sesión ----------

async function ingresar() {
  const usuario = h('input', {
    class: 'campo',
    type: 'text',
    name: 'usuario',
    autocomplete: 'username',
    autocapitalize: 'none',
    spellcheck: 'false',
    maxlength: 40,
    required: true,
  });
  const clave = h('input', { class: 'campo', type: 'password', name: 'clave', autocomplete: 'current-password', required: true });
  const error = h('p', { class: 'error-form', hidden: true });
  const ok = await modal({
    titulo: 'Ingresar',
    contenido: [
      h('p', { class: 'texto-suave' }, 'El acceso a la biblioteca es libre. Ingresa solo para crear, editar o administrar procedimientos.'),
      h('label', { class: 'etiqueta' }, 'Usuario', usuario),
      h('label', { class: 'etiqueta' }, 'Clave', clave),
      error,
    ],
    botones: [
      { texto: 'Cancelar', valor: false },
      {
        texto: 'Ingresar',
        submit: true,
        clase: 'btn-primario',
        accion: async () => {
          try {
            const r = await api('POST', '/api/login', { usuario: usuario.value, clave: clave.value });
            estado.usuario = r.usuario;
            return true;
          } catch (e) {
            error.textContent = e.message;
            error.hidden = false;
            clave.select();
            return undefined;
          }
        },
      },
    ],
  });
  if (ok) {
    aviso(`Bienvenido, ${estado.usuario.usuario}`);
    pintarCabecera();
    // con el formulario del generador abierto no se recarga la vista: se perdería lo no guardado
    if (!document.querySelector('#g-nombre')) enrutar();
  }
  return !!ok;
}
estado.pedirIngreso = ingresar;

async function salir() {
  await api('POST', '/api/logout');
  estado.usuario = null;
  aviso('Sesión cerrada');
  pintarCabecera();
  if (location.hash.startsWith('#/generador') || location.hash === '#/papelera') location.hash = '#/';
  else enrutar();
}

function pintarCabecera() {
  const nav = document.getElementById('nav');
  const ruta = location.hash || '#/';
  const enlace = (href, texto) =>
    h('a', { href, class: ruta === href || (href !== '#/' && ruta.startsWith(href)) || (href === '#/' && ruta.startsWith('#/procedimiento')) ? 'activo' : '' }, texto);
  poner(nav, 
    enlace('#/', 'Biblioteca'),
    puedeEditar() ? enlace('#/generador', 'Crear Procedimiento') : null,
    esAdmin() ? enlace('#/papelera', 'Papelera') : null,
  );

  const zona = document.getElementById('zona-usuario');
  if (!estado.usuario) {
    poner(zona, h('button', { class: 'btn-usuario', onclick: ingresar }, icono('usuario'), 'Ingresar'));
    return;
  }
  const menu = h(
    'div',
    { class: 'menu-usuario', hidden: true },
    h('div', { class: 'menu-rol' }, esAdmin() ? 'Administrador · acceso total' : 'Editor · crear y modificar'),
    h('button', { class: 'menu-item', onclick: salir }, icono('salir'), 'Cerrar sesión'),
  );
  const boton = h(
    'button',
    {
      class: 'btn-usuario',
      'aria-haspopup': 'true',
      onclick: (e) => {
        e.stopPropagation();
        menu.hidden = !menu.hidden;
      },
    },
    icono('usuario'),
    estado.usuario.usuario,
  );
  poner(zona, h('div', { class: 'usuario-envoltura' }, boton, menu));
}

// ---------- papelera (solo administrador) ----------

async function vistaPapelera(cont) {
  if (!esAdmin()) {
    poner(cont, h('div', { class: 'wrap vacio' }, 'Solo el administrador puede ver la papelera.'));
    return;
  }
  const { elementos } = await api('GET', '/api/papelera');
  const accion = async (fn, msg) => {
    try {
      const r = await fn();
      if (r === null) return; // cancelado
      aviso(typeof msg === 'function' ? msg(r) : msg);
      await cargarBiblioteca();
      vistaPapelera(cont);
    } catch (e) {
      aviso(e.message, 'error');
    }
  };
  // Si la categoría original de un procedimiento ya no existe, se elige dónde restaurarlo.
  const restaurar = async (e) => {
    let categoria;
    if (e.tipo === 'ficha' && !e.origenExiste) {
      await cargarBiblioteca();
      const lista = categoriasPlanas();
      if (!lista.length) {
        aviso('No hay categorías: crea una en la Biblioteca para restaurar el procedimiento', 'error');
        return null;
      }
      const select = h(
        'select',
        { class: 'campo' },
        lista.map((c) => h('option', { value: JSON.stringify(c.ruta) }, `${'\u00a0\u00a0\u00a0'.repeat(c.nivel)}${c.ruta.at(-1)}`)),
      );
      categoria = await modal({
        titulo: 'Elegir dónde restaurar',
        contenido: [
          h('p', {}, `La categoría original de «${e.nombre}» (${textoRuta(e.origen.slice(0, -1))}) ya no existe. Elige dónde guardarlo:`),
          h('label', { class: 'etiqueta' }, 'Categoría', select),
        ],
        botones: [
          { texto: 'Cancelar', valor: null },
          { texto: 'Restaurar aquí', submit: true, clase: 'btn-primario', accion: () => JSON.parse(select.value) },
        ],
      });
      if (!categoria) return null;
    }
    return api('POST', `/api/papelera/${e.id}/restaurar`, { categoria });
  };
  const mensajeRestaurado = (r) =>
    r.tipo === 'version'
      ? `Versión ${r.version} restaurada en «${r.procedimiento}» (${textoRuta(r.destino)})`
      : `Procedimiento restaurado en «${textoRuta(r.destino)}»`;
  const filas = elementos.map((e) =>
    h(
      'tr',
      {},
      h('td', {}, h('span', { class: `insignia ${e.tipo === 'ficha' ? '' : 'insignia-suave'}` }, e.tipo === 'ficha' ? 'Procedimiento' : 'Versión')),
      h('td', { class: 'fuerte' }, e.nombre),
      h(
        'td',
        {},
        textoRuta(e.origen.slice(0, -1)),
        e.tipo === 'ficha' && !e.origenExiste ? h('small', { class: 'nota-papelera' }, 'Ya no existe: al restaurar se elige dónde') : null,
      ),
      h('td', {}, `${fechaHora(e.borrado)} · ${e.usuario}`),
      h(
        'td',
        { class: 'acciones-tabla' },
        h(
          'button',
          { class: 'btn btn-secundario btn-chico', onclick: () => accion(() => restaurar(e), mensajeRestaurado) },
          icono('restaurar'),
          'Restaurar',
        ),
        h(
          'button',
          {
            class: 'btn btn-peligro-suave btn-chico',
            onclick: async () => {
              if (await confirmar('Eliminar definitivamente', `"${e.nombre}" se borrará del servidor y no se podrá recuperar.`, 'Eliminar', true)) {
                accion(() => api('DELETE', `/api/papelera/${e.id}`), 'Eliminado definitivamente');
              }
            },
          },
          icono('basura'),
          'Eliminar',
        ),
      ),
    ),
  );
  poner(cont, 
    h(
      'section',
      { class: 'hero hero-chico' },
      h('div', { class: 'wrap' }, h('h1', {}, 'Papelera'), h('p', {}, 'Procedimientos y versiones eliminados. Los procedimientos vuelven a su categoría y las versiones a su procedimiento.')),
    ),
    h(
      'div',
      { class: 'wrap' },
      h(
        'div',
        { class: 'tarjeta tarjeta-sobre-hero' },
        h(
          'div',
          { class: 'tarjeta-cabecera' },
          h('h2', {}, `${elementos.length} elemento(s)`),
          h(
            'button',
            {
              class: 'btn btn-secundario btn-chico',
              onclick: async () => {
                const r = await api('POST', '/api/reindexar');
                await cargarBiblioteca();
                aviso(`Índice reconstruido: ${r.fichas} fichas`);
              },
            },
            icono('restaurar'),
            'Reconstruir índice',
          ),
        ),
        elementos.length
          ? h(
              'div',
              { class: 'tabla-envoltura' },
              h(
                'table',
                { class: 'tabla' },
                h('thead', {}, h('tr', {}, ['Tipo', 'Nombre', 'Ubicación original', 'Eliminado', ''].map((t) => h('th', {}, t)))),
                h('tbody', {}, filas),
              ),
            )
          : h('p', { class: 'vacio' }, 'La papelera está vacía.'),
      ),
    ),
  );
}

// ---------- rutas ----------

let rutaActual = location.hash;

async function enrutar() {
  pintarCabecera();
  const ruta = location.hash || '#/';
  rutaActual = ruta;
  window.scrollTo(0, 0);
  poner(principal, h('div', { class: 'cargando' }, 'Cargando…'));
  try {
    let m;
    if ((m = /^#\/generador(?:\/([\w-]+))?$/.exec(ruta))) {
      if (!puedeEditar()) {
        poner(principal, 
          h(
            'div',
            { class: 'wrap vacio' },
            h('p', {}, 'Debes ingresar como editor o administrador para crear procedimientos.'),
            h('button', { class: 'btn btn-primario', onclick: ingresar }, 'Ingresar'),
          ),
        );
        return;
      }
      await vistaGenerador(principal, m[1]);
    } else if ((m = /^#\/procedimiento\/([\w-]+)(?:\/(\d{1,3}\.\d))?$/.exec(ruta))) {
      await vistaProcedimiento(principal, m[1], m[2]);
    } else if (ruta === '#/papelera') {
      await vistaPapelera(principal);
    } else {
      await vistaBiblioteca(principal);
    }
  } catch (e) {
    poner(principal, h('div', { class: 'wrap vacio' }, h('p', {}, e.message)));
  }
}

window.addEventListener('hashchange', () => {
  if (estado.cambiosSinGuardar && location.hash !== rutaActual) {
    if (!window.confirm('Hay cambios sin guardar en el procedimiento. ¿Salir de todas formas?')) {
      history.replaceState(null, '', rutaActual);
      return;
    }
    estado.cambiosSinGuardar = false;
  }
  enrutar();
});

document.addEventListener('click', () => document.querySelectorAll('.menu-usuario').forEach((m) => (m.hidden = true)));

window.addEventListener('beforeunload', (e) => {
  if (estado.cambiosSinGuardar) e.preventDefault();
});

(async function iniciar() {
  try {
    estado.usuario = (await api('GET', '/api/sesion')).usuario;
  } catch {
    estado.usuario = null;
  }
  enrutar();
})();
