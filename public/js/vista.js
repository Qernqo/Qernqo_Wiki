// Vista continua de un procedimiento: se lee de corrido, sin saltos de página.
// El PDF A4 paginado queda para descargar.
import { h, icono, api, fechaLarga, fechaCorta, fechaHora, poner, urlImagen } from './util.js';
import { puedeEditar, textoRuta } from './estado.js';
import { qrSvg } from './qr.js';

function ampliar(src, alt) {
  const cerrar = () => {
    fondo.remove();
    document.removeEventListener('keydown', teclado);
  };
  const teclado = (e) => e.key === 'Escape' && cerrar();
  const fondo = h(
    'div',
    { class: 'ampliacion', role: 'dialog', 'aria-label': 'Imagen ampliada', onclick: cerrar },
    h('img', { src, alt }),
    h('button', { class: 'ampliacion-cerrar', 'aria-label': 'Cerrar' }, icono('cerrar')),
  );
  document.body.append(fondo);
  document.addEventListener('keydown', teclado);
}

export async function vistaProcedimiento(cont, id, version) {
  const detalle = await api('GET', `/api/fichas/${id}${version ? `?version=${encodeURIComponent(version)}` : ''}`);
  const d = detalle.datos;
  const esVigente = d.version === detalle.versionActual;
  const actual = detalle.versiones.find((v) => v.version === d.version);

  const dato = (etiqueta, valor) => h('div', { class: 'proc-dato' }, h('span', {}, etiqueta), h('strong', {}, valor));

  const pasos = d.pasos.map((p, i) =>
    h(
      'li',
      { class: 'proc-paso' },
      h('span', { class: 'paso-num', 'aria-hidden': 'true' }, i + 1),
      h(
        'div',
        { class: 'proc-paso-cuerpo' },
        h('h3', {}, `Paso ${i + 1}`),
        p.texto ? h('p', { class: 'proc-texto' }, p.texto) : null,
        p.imagenes.map((ruta, k) => {
          const src = urlImagen(detalle.base, ruta);
          const alt = `Paso ${i + 1}, imagen ${k + 1}`;
          return h(
            'button',
            { class: 'proc-imagen', type: 'button', title: 'Ampliar imagen', onclick: () => ampliar(src, alt) },
            h('img', { src, alt, loading: 'lazy' }),
          );
        }),
      ),
    ),
  );

  const versiones = detalle.versiones.map((v) =>
    h(
      'li',
      { class: v.version === d.version ? 'actual' : '' },
      h(
        'div',
        { class: 'proc-version-info' },
        h('strong', {}, `v${v.version}`, v.version === detalle.versionActual ? h('span', { class: 'insignia' }, 'Vigente') : null),
        h('small', {}, `${fechaLarga(v.fecha)} · ${v.autor}`),
        h('small', { class: 'texto-suave' }, `Guardado ${fechaHora(v.guardado)} · ${v.usuario}`),
      ),
      h(
        'div',
        { class: 'proc-version-acciones' },
        v.version === d.version
          ? h('span', { class: 'texto-suave' }, 'Viendo')
          : h('a', { class: 'enlace', href: `#/procedimiento/${id}/${v.version}` }, 'Ver'),
        h('a', { class: 'enlace', href: v.url, download: '' }, 'PDF'),
      ),
    ),
  );

  poner(
    cont,
    h(
      'section',
      { class: 'hero hero-chico' },
      h(
        'div',
        { class: 'wrap' },
        h('a', { class: 'volver', href: '#/' }, icono('atras'), 'Biblioteca'),
        h('p', { class: 'proc-ruta' }, detalle.categoria.join(' › ')),
        h('h1', {}, d.nombre),
      ),
    ),
    h(
      'div',
      { class: 'wrap proc' },
      h(
        'article',
        { class: 'tarjeta proc-doc' },
        esVigente
          ? null
          : h(
              'p',
              { class: 'proc-aviso' },
              `Estás viendo la versión ${d.version}. La versión vigente es la ${detalle.versionActual}. `,
              h('a', { href: `#/procedimiento/${id}` }, 'Ver la vigente'),
            ),
        h(
          'div',
          { class: 'proc-datos' },
          dato('Versión', d.version),
          dato('Fecha', fechaCorta(d.fecha)),
          dato('Categoría', textoRuta(detalle.categoria)),
          dato('Elaborado por', d.autor),
        ),
        d.tags && d.tags.length ? h('div', { class: 'ficha-tags' }, d.tags.map((t) => h('span', { class: 'chip chip-chico chip-activo' }, t))) : null,
        d.link
          ? h(
              'div',
              { class: 'proc-link' },
              h('div', { class: 'proc-qr', html: qrSvg(d.link) }),
              h(
                'div',
                {},
                h('strong', {}, 'Link de descarga'),
                h('a', { href: d.link, target: '_blank', rel: 'noopener' }, d.link),
                h('small', { class: 'texto-suave' }, 'Escanea el código QR o haz clic en el enlace.'),
              ),
            )
          : null,
        h('h2', { class: 'proc-titulo' }, 'Procedimiento'),
        h('ol', { class: 'proc-pasos' }, pasos),
        h(
          'footer',
          { class: 'proc-pie' },
          h('strong', {}, `Elaborado por: ${d.autor}`),
          h('span', {}, `${d.nombre} · Versión ${d.version} · ${fechaCorta(d.fecha)}`),
        ),
      ),
      h(
        'aside',
        { class: 'proc-lateral' },
        h(
          'div',
          { class: 'tarjeta proc-acciones' },
          h('a', { class: 'btn btn-primario btn-bloque', href: actual.url, download: '' }, icono('descargar'), 'Descargar PDF'),
          h('p', { class: 'ayuda' }, 'PDF en formato A4, separado por páginas.'),
          puedeEditar() && esVigente ? h('a', { class: 'btn btn-secundario btn-bloque', href: `#/generador/${id}` }, icono('lapiz'), 'Editar (nueva versión)') : null,
        ),
        h('div', { class: 'tarjeta' }, h('h2', {}, 'Historial de versiones'), h('ul', { class: 'proc-versiones' }, versiones)),
      ),
    ),
  );
}
