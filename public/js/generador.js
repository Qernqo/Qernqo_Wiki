// Vista Generador: crea una ficha nueva o una nueva versión de una existente.
/* global Sortable */
import {
  h,
  icono,
  api,
  aviso,
  confirmar,
  pedirTexto,
  hoyISO,
  parseVersion,
  compararVersion,
  siguienteVersion,
  blobADataUrl,
  poner,
} from './util.js';
import { estado, categoriasPlanas, cargarBiblioteca, textoRuta } from './estado.js';
import { crearPdf } from './pdf.js';
import { qrSvg } from './qr.js';

const MAX_IMAGENES = 4;
const MAX_LADO = 1600; // px
let contador = 0;
const nuevoId = () => `p${++contador}`;

let f; // estado del formulario
let cont;

// ---------- imágenes ----------

function cargarImagen(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No se pudo leer la imagen'));
    img.src = src;
  });
}

// Reduce a máx. 1600 px y convierte a JPEG (fondo blanco para PNG transparentes).
async function procesarImagen(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const img = await cargarImagen(url);
    const escala = Math.min(1, MAX_LADO / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * escala));
    const alto = Math.max(1, Math.round(img.naturalHeight * escala));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = alto;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, alto);
    ctx.drawImage(img, 0, 0, w, alto);
    return { id: nuevoId(), src: canvas.toDataURL('image/jpeg', 0.86), w, h: alto };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function imagenDesdeUrl(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('No se pudo cargar una imagen del procedimiento');
  const blob = await r.blob();
  if (blob.type !== 'image/jpeg') return procesarImagen(blob);
  const src = await blobADataUrl(blob);
  const img = await cargarImagen(src);
  return { id: nuevoId(), src, w: img.naturalWidth, h: img.naturalHeight };
}

async function agregarImagenes(paso, archivos) {
  const imagenes = [...archivos].filter((a) => a.type.startsWith('image/'));
  const libres = MAX_IMAGENES - paso.imagenes.length;
  if (!imagenes.length) return;
  if (imagenes.length > libres) aviso(`Cada paso admite hasta ${MAX_IMAGENES} imágenes`, 'error');
  for (const archivo of imagenes.slice(0, Math.max(0, libres))) {
    try {
      paso.imagenes.push(await procesarImagen(archivo));
    } catch (e) {
      aviso(e.message, 'error');
    }
  }
  marcarCambios();
  pintarImagenes(paso);
}

// ---------- pasos ----------

const marcarCambios = () => (estado.cambiosSinGuardar = true);

function renumerar() {
  cont.querySelectorAll('.paso').forEach((el, i) => {
    el.querySelector('.paso-num').textContent = i + 1;
    el.querySelector('.paso-titulo').textContent = `Paso ${i + 1}`;
    el.querySelector('textarea').setAttribute('aria-label', `Texto del paso ${i + 1}`);
  });
  cont.querySelector('#total-pasos').textContent = `${f.pasos.length} paso${f.pasos.length === 1 ? '' : 's'}`;
}

function pintarImagenes(paso) {
  const zona = cont.querySelector(`.paso[data-id="${paso.id}"] .paso-imagenes`);
  if (!zona) return;
  const entrada = h('input', {
    type: 'file',
    accept: 'image/*',
    multiple: true,
    hidden: true,
    onchange: (e) => agregarImagenes(paso, e.target.files),
  });
  poner(zona, 
    ...paso.imagenes.map((img) =>
      h(
        'figure',
        { class: 'miniatura', dataset: { id: img.id } },
        h('img', { src: img.src, alt: '' }),
        h(
          'button',
          {
            type: 'button',
            class: 'miniatura-quitar',
            'aria-label': 'Quitar imagen',
            onclick: () => {
              paso.imagenes = paso.imagenes.filter((x) => x !== img);
              marcarCambios();
              pintarImagenes(paso);
            },
          },
          icono('cerrar'),
        ),
      ),
    ),
    paso.imagenes.length < MAX_IMAGENES
      ? h(
          'button',
          { type: 'button', class: 'miniatura-agregar', onclick: () => entrada.click() },
          icono('imagen'),
          h('span', {}, 'Agregar imagen'),
          h('small', {}, `${paso.imagenes.length}/${MAX_IMAGENES}`),
          entrada,
        )
      : null,
  );
  // reordenar imágenes dentro del paso
  if (!zona._sortable) {
    zona._sortable = Sortable.create(zona, {
      draggable: '.miniatura',
      animation: 150,
      onEnd: () => {
        const orden = [...zona.querySelectorAll('.miniatura')].map((el) => el.dataset.id);
        paso.imagenes.sort((a, b) => orden.indexOf(a.id) - orden.indexOf(b.id));
        marcarCambios();
      },
    });
  }
}

function tarjetaPaso(paso) {
  const texto = h('textarea', {
    class: 'campo paso-texto',
    rows: 3,
    maxlength: 8000,
    placeholder: 'Describe este paso. Puedes pegar capturas de pantalla con Ctrl+V.',
    oninput: (e) => {
      paso.texto = e.target.value;
      ajustarAlto(e.target);
    },
    onpaste: (e) => {
      const archivos = [...(e.clipboardData?.files || [])];
      if (archivos.some((a) => a.type.startsWith('image/'))) {
        e.preventDefault();
        agregarImagenes(paso, archivos);
      }
    },
  });
  texto.value = paso.texto;
  const el = h(
    'div',
    {
      class: 'paso',
      dataset: { id: paso.id },
      ondragover: (e) => {
        if ([...e.dataTransfer.types].includes('Files')) {
          e.preventDefault();
          el.classList.add('soltando');
        }
      },
      ondragleave: () => el.classList.remove('soltando'),
      ondrop: (e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        el.classList.remove('soltando');
        agregarImagenes(paso, e.dataTransfer.files);
      },
    },
    h(
      'div',
      { class: 'paso-cabecera' },
      h('button', { type: 'button', class: 'paso-asa', title: 'Arrastra para reordenar', 'aria-label': 'Arrastrar paso' }, icono('arrastrar')),
      h('span', { class: 'paso-num' }),
      h('strong', { class: 'paso-titulo' }),
      h(
        'button',
        {
          type: 'button',
          class: 'btn-icono peligro',
          title: 'Eliminar paso',
          'aria-label': 'Eliminar paso',
          onclick: async () => {
            const tieneContenido = paso.texto.trim() || paso.imagenes.length;
            if (tieneContenido && !(await confirmar('Eliminar paso', '¿Eliminar este paso y sus imágenes?', 'Eliminar', true))) return;
            f.pasos = f.pasos.filter((p) => p !== paso);
            el.remove();
            if (!f.pasos.length) agregarPaso();
            marcarCambios();
            renumerar();
          },
        },
        icono('basura'),
      ),
    ),
    texto,
    h('div', { class: 'paso-imagenes' }),
    h('p', { class: 'paso-ayuda' }, `Hasta ${MAX_IMAGENES} imágenes por paso. Arrástralas aquí, pégalas o usa "Agregar imagen". Puedes reordenarlas arrastrando.`),
  );
  requestAnimationFrame(() => ajustarAlto(texto));
  return el;
}

function ajustarAlto(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = `${Math.max(80, textarea.scrollHeight + 2)}px`;
}

function agregarPaso(enfocar = false) {
  const paso = { id: nuevoId(), texto: '', imagenes: [] };
  f.pasos.push(paso);
  const el = tarjetaPaso(paso);
  cont.querySelector('#pasos').append(el);
  pintarImagenes(paso);
  renumerar();
  if (enfocar) {
    el.querySelector('textarea').focus();
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

// ---------- tags ----------

function pintarTags() {
  const zona = cont.querySelector('#tags');
  const entrada = cont.querySelector('#tag-entrada');
  zona.querySelectorAll('.chip').forEach((c) => c.remove());
  f.datos.tags.forEach((t) =>
    zona.insertBefore(
      h(
        'span',
        { class: 'chip chip-activo' },
        t,
        h(
          'button',
          {
            type: 'button',
            class: 'chip-quitar',
            'aria-label': `Quitar tag ${t}`,
            onclick: () => {
              f.datos.tags = f.datos.tags.filter((x) => x !== t);
              marcarCambios();
              pintarTags();
            },
          },
          icono('cerrar', 'icono-chico'),
        ),
      ),
      entrada,
    ),
  );
}

function agregarTag(valor) {
  const nuevos = valor
    .split(',')
    .map((t) => t.trim().replace(/\s+/g, ' ').slice(0, 40))
    .filter(Boolean);
  for (const t of nuevos) {
    if (!f.datos.tags.some((x) => x.toLowerCase() === t.toLowerCase()) && f.datos.tags.length < 30) f.datos.tags.push(t);
  }
  marcarCambios();
  pintarTags();
}

// ---------- QR ----------

function pintarQr() {
  const zona = cont.querySelector('#qr');
  const link = f.datos.link.trim();
  if (/^https?:\/\/\S+$/i.test(link)) {
    zona.innerHTML = qrSvg(link);
    zona.classList.remove('qr-vacio');
  } else {
    poner(zona, h('span', {}, link ? 'El link debe comenzar con http:// o https://' : 'El código QR aparecerá al ingresar el link de descarga'));
    zona.classList.add('qr-vacio');
  }
}

// ---------- validación y guardado ----------

function validar() {
  const errores = [];
  const d = f.datos;
  const marcar = (id, ok) => cont.querySelector(id)?.classList.toggle('invalido', !ok);
  if (!d.nombre.trim()) errores.push('Ingresa el nombre del procedimiento');
  marcar('#g-nombre', !!d.nombre.trim());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.fecha)) errores.push('Ingresa la fecha');
  marcar('#g-fecha', /^\d{4}-\d{2}-\d{2}$/.test(d.fecha));
  let versionOk = !!parseVersion(d.version);
  if (!versionOk) errores.push('La versión debe tener el formato X.Y (Y entre 0 y 9), por ejemplo 1.0');
  else if (f.versionMayor && compararVersion(d.version, f.versionMayor) <= 0) {
    versionOk = false;
    errores.push(`La versión debe ser mayor que ${f.versionMayor}`);
  }
  marcar('#g-version', versionOk);
  if (!d.autor.trim()) errores.push('Ingresa quién elabora el procedimiento ("Elaborado por")');
  marcar('#g-autor', !!d.autor.trim());
  if (!f.categoria.length) errores.push('Selecciona una categoría');
  marcar('#g-categoria', !!f.categoria.length);
  const linkOk = !d.link.trim() || /^https?:\/\/\S+$/i.test(d.link.trim());
  if (!linkOk) errores.push('El link debe comenzar con http:// o https://');
  marcar('#g-link', linkOk);
  f.pasos.forEach((p, i) => {
    if (!p.texto.trim() && !p.imagenes.length) errores.push(`El paso ${i + 1} está vacío`);
  });
  return [...new Set(errores)];
}

function datosParaPdf() {
  const d = f.datos;
  return {
    nombre: d.nombre.trim(),
    fecha: d.fecha,
    version: d.version.trim(),
    autor: d.autor.trim(),
    link: d.link.trim(),
    tags: d.tags,
    pasos: f.pasos.map((p) => ({ texto: p.texto.trim(), imagenes: p.imagenes })),
  };
}

function mostrarErrores(errores) {
  const zona = cont.querySelector('#errores');
  zona.hidden = !errores.length;
  poner(zona, h('strong', {}, 'Revisa lo siguiente:'), h('ul', {}, errores.map((e) => h('li', {}, e))));
  if (errores.length) zona.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function vistaPrevia(boton) {
  const errores = validar();
  mostrarErrores(errores);
  if (errores.length) return;
  const ventana = window.open('', '_blank');
  boton.disabled = true;
  try {
    const doc = await crearPdf(datosParaPdf(), textoRuta(f.categoria));
    if (ventana) ventana.location.href = doc.output('bloburl');
    else doc.save('vista-previa.pdf');
  } catch (e) {
    if (ventana) ventana.close();
    aviso(`No se pudo generar el PDF: ${e.message}`, 'error');
  } finally {
    boton.disabled = false;
  }
}

async function guardar(boton) {
  const errores = validar();
  mostrarErrores(errores);
  if (errores.length) return;
  const texto = boton.lastChild.textContent;
  boton.disabled = true;
  boton.lastChild.textContent = 'Generando PDF…';
  try {
    const datos = datosParaPdf();
    const doc = await crearPdf(datos, textoRuta(f.categoria));
    const pdf = doc.output('datauristring').split(',')[1];
    boton.lastChild.textContent = 'Guardando…';
    const cuerpo = {
      datos: { ...datos, pasos: datos.pasos.map((p) => ({ texto: p.texto, imagenes: p.imagenes.map((i) => i.src) })) },
      pdf,
    };
    if (f.id) await api('POST', `/api/fichas/${f.id}/versiones`, cuerpo);
    else await api('POST', '/api/fichas', { ...cuerpo, categoria: f.categoria });
    estado.cambiosSinGuardar = false;
    aviso(f.id ? `Versión ${datos.version} guardada` : 'Procedimiento guardado en la biblioteca');
    location.hash = '#/';
  } catch (e) {
    aviso(e.message, 'error');
  } finally {
    boton.disabled = false;
    boton.lastChild.textContent = texto;
  }
}

// ---------- categorías ----------

function opcionesCategoria(select) {
  const lista = categoriasPlanas();
  poner(select, 
    h('option', { value: '' }, lista.length ? 'Selecciona una categoría…' : 'No hay categorías: crea una con el botón +'),
    ...lista.map((c) =>
      h('option', { value: JSON.stringify(c.ruta), selected: textoRuta(f.categoria) === c.texto }, `${'   '.repeat(c.nivel)}${c.ruta.at(-1)}`),
    ),
  );
}

async function nuevaCategoria(select) {
  const padre = f.categoria;
  if (padre.length >= estado.biblioteca.maxNiveles) {
    aviso(`Se alcanzó el máximo de ${estado.biblioteca.maxNiveles} niveles`, 'error');
    return;
  }
  const nombre = await pedirTexto(padre.length ? `Nueva subcategoría en "${textoRuta(padre)}"` : 'Nueva categoría', 'Nombre');
  if (!nombre) return;
  try {
    const r = await api('POST', '/api/categorias', { padre, nombre });
    await cargarBiblioteca();
    f.categoria = r.ruta;
    opcionesCategoria(select);
    aviso('Categoría creada');
  } catch (e) {
    aviso(e.message, 'error');
  }
}

// ---------- vista ----------

export async function vistaGenerador(contenedor, id) {
  cont = contenedor;
  estado.cambiosSinGuardar = false;
  await cargarBiblioteca();
  f = {
    id: id || null,
    versionMayor: null,
    categoria: [],
    datos: { nombre: '', fecha: hoyISO(), version: '1.0', autor: '', link: '', tags: [] },
    pasos: [],
  };
  let pasosIniciales = [];
  if (id) {
    const detalle = await api('GET', `/api/fichas/${id}`);
    const d = detalle.datos;
    f.versionMayor = detalle.versiones[0].version; // vienen ordenadas de mayor a menor
    f.categoria = detalle.categoria;
    Object.assign(f.datos, { nombre: d.nombre, link: d.link || '', tags: [...(d.tags || [])], version: siguienteVersion(f.versionMayor) });
    pasosIniciales = await Promise.all(
      d.pasos.map(async (p) => ({
        id: nuevoId(),
        texto: p.texto || '',
        imagenes: await Promise.all(p.imagenes.map((ruta) => imagenDesdeUrl(detalle.base + ruta.split('/').map(encodeURIComponent).join('/')))),
      })),
    );
  }

  const campo = (idCampo, etiqueta, control, ayuda, clase = '') =>
    h('label', { class: `etiqueta ${clase}`, for: idCampo }, h('span', {}, etiqueta), control, ayuda ? h('small', { class: 'ayuda' }, ayuda) : null);
  const enlazar = (clave, extra) => (e) => {
    f.datos[clave] = e.target.value;
    marcarCambios();
    extra && extra();
  };

  const selCategoria = h('select', {
    id: 'g-categoria',
    class: 'campo',
    disabled: !!id,
    onchange: (e) => {
      f.categoria = e.target.value ? JSON.parse(e.target.value) : [];
      marcarCambios();
    },
  });
  opcionesCategoria(selCategoria);

  const entradaTag = h('input', {
    id: 'tag-entrada',
    class: 'tag-entrada',
    placeholder: f.datos.tags.length ? '' : 'Escribe un tag y presiona Enter',
    list: 'lista-tags',
    maxlength: 40,
    onkeydown: (e) => {
      if ((e.key === 'Enter' || e.key === ',') && e.target.value.trim()) {
        e.preventDefault();
        agregarTag(e.target.value);
        e.target.value = '';
      } else if (e.key === 'Enter') {
        e.preventDefault();
      } else if (e.key === 'Backspace' && !e.target.value && f.datos.tags.length) {
        f.datos.tags.pop();
        pintarTags();
      }
    },
    onblur: (e) => {
      if (e.target.value.trim()) {
        agregarTag(e.target.value);
        e.target.value = '';
      }
    },
  });
  const tagsExistentes = [...new Set(estado.biblioteca.fichas.flatMap((x) => x.tags))].sort((a, b) => a.localeCompare(b, 'es'));

  const btnPrevia = h('button', { type: 'button', class: 'btn btn-secundario btn-bloque', onclick: () => vistaPrevia(btnPrevia) }, icono('pdf'), 'Vista previa PDF');
  const btnGuardar = h(
    'button',
    { type: 'button', class: 'btn btn-primario btn-bloque', onclick: () => guardar(btnGuardar) },
    icono('descargar'),
    h('span', {}, id ? 'Guardar nueva versión' : 'Guardar en biblioteca'),
  );

  poner(cont, 
    h(
      'section',
      { class: 'hero hero-chico' },
      h(
        'div',
        { class: 'wrap' },
        h('h1', {}, id ? 'Editar procedimiento' : 'Generador de procedimientos'),
        h(
          'p',
          {},
          id
            ? `Estás creando una nueva versión de "${f.datos.nombre}". La versión vigente es la ${f.versionMayor}; las anteriores quedan en el historial.`
            : 'Completa los datos, agrega los pasos y guarda: se generará un PDF con el formato estándar.',
        ),
      ),
    ),
    h(
      'div',
      { class: 'wrap generador' },
      h(
        'div',
        { class: 'generador-principal' },
        h('div', { id: 'errores', class: 'errores', hidden: true, role: 'alert' }),
        h(
          'section',
          { class: 'tarjeta' },
          h('div', { class: 'tarjeta-cabecera' }, h('h2', {}, 'Datos generales')),
          h(
            'div',
            { class: 'grilla-form' },
            campo(
              'g-nombre',
              'Nombre del procedimiento *',
              h('input', { id: 'g-nombre', class: 'campo', maxlength: 150, value: f.datos.nombre, oninput: enlazar('nombre') }),
              null,
              'col-completa',
            ),
            campo('g-fecha', 'Fecha *', h('input', { id: 'g-fecha', type: 'date', class: 'campo', value: f.datos.fecha, oninput: enlazar('fecha') })),
            campo(
              'g-version',
              'Versión *',
              h('input', { id: 'g-version', class: 'campo', maxlength: 5, value: f.datos.version, placeholder: '1.0', inputmode: 'decimal', oninput: enlazar('version') }),
              f.versionMayor ? `Vigente: ${f.versionMayor}. Formato X.Y (1.0 → 1.9 → 2.0)` : 'Formato X.Y (1.0 → 1.9 → 2.0)',
            ),
            campo(
              'g-autor',
              'Elaborado por *',
              h('input', { id: 'g-autor', class: 'campo', maxlength: 80, value: f.datos.autor, placeholder: 'Nombre y apellido', oninput: enlazar('autor') }),
              'Aparece en el pie de página del PDF',
            ),
            h(
              'label',
              { class: 'etiqueta col-completa', for: 'g-categoria' },
              h('span', {}, 'Categoría *'),
              h(
                'div',
                { class: 'campo-con-boton' },
                selCategoria,
                id
                  ? null
                  : h(
                      'button',
                      { type: 'button', class: 'btn btn-secundario', title: 'Crear subcategoría dentro de la seleccionada (o categoría principal si no hay selección)', onclick: () => nuevaCategoria(selCategoria) },
                      icono('mas'),
                    ),
              ),
              id ? h('small', { class: 'ayuda' }, 'Para cambiar la categoría usa "Mover" en la Biblioteca.') : null,
            ),
            campo(
              'g-link',
              'Link de descarga',
              h('input', { id: 'g-link', type: 'url', class: 'campo', maxlength: 500, value: f.datos.link, placeholder: 'https://…', oninput: enlazar('link', pintarQr) }),
              'Enlace al recurso externo. Se imprime en el procedimiento junto a un código QR.',
              'col-completa',
            ),
            h(
              'div',
              { class: 'etiqueta col-completa' },
              h('span', {}, 'Tags'),
              h('div', { id: 'tags', class: 'campo campo-tags', onclick: () => entradaTag.focus() }, entradaTag),
              h('datalist', { id: 'lista-tags' }, tagsExistentes.map((t) => h('option', { value: t }))),
              h('small', { class: 'ayuda' }, 'Tags libres para indexar el procedimiento. Separa con Enter o coma.'),
            ),
          ),
        ),
        h(
          'section',
          { class: 'tarjeta' },
          h('div', { class: 'tarjeta-cabecera' }, h('h2', {}, 'Pasos'), h('span', { id: 'total-pasos', class: 'texto-suave' })),
          h('div', { id: 'pasos', class: 'pasos' }),
          h('button', { type: 'button', class: 'btn-agregar-paso', onclick: () => agregarPaso(true) }, icono('mas'), 'Agregar paso'),
        ),
      ),
      h(
        'aside',
        { class: 'generador-lateral' },
        h(
          'div',
          { class: 'tarjeta lateral-fijo' },
          h('h2', {}, 'Código QR'),
          h('div', { id: 'qr', class: 'qr' }),
          h('div', { class: 'lateral-acciones' }, btnGuardar, btnPrevia, h('a', { class: 'btn btn-texto btn-bloque', href: '#/' }, 'Cancelar')),
          h('p', { class: 'ayuda' }, 'El PDF se genera en tu navegador con formato A4. Texto y código QR son vectoriales.'),
        ),
      ),
    ),
  );

  pintarTags();
  pintarQr();
  (pasosIniciales.length ? pasosIniciales : [{ id: nuevoId(), texto: '', imagenes: [] }]).forEach((p) => {
    f.pasos.push(p);
    cont.querySelector('#pasos').append(tarjetaPaso(p));
    pintarImagenes(p);
  });
  renumerar();

  Sortable.create(cont.querySelector('#pasos'), {
    handle: '.paso-asa',
    animation: 160,
    ghostClass: 'paso-fantasma',
    onEnd: () => {
      const orden = [...cont.querySelectorAll('.paso')].map((el) => el.dataset.id);
      f.pasos.sort((a, b) => orden.indexOf(a.id) - orden.indexOf(b.id));
      marcarCambios();
      renumerar();
    },
  });
  cont.querySelector('#g-nombre').focus();
}
