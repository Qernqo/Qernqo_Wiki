'use strict';
// Biblioteca basada en carpetas. La carpeta BIBLIOTECA es la fuente de verdad:
//
//   biblioteca/<Categoría>/<Sub 1>/.../<slug-ficha>/
//       ficha.json                 ← id, versión vigente e historial
//       v1.0/datos.json            ← contenido de la versión (para editar)
//       v1.0/img/paso01-1.jpg
//       v1.0/<slug>_v1.0.pdf
//
// El índice de búsqueda se reconstruye leyendo estas carpetas, por lo que se
// pueden copiar/mover a otro servidor sin perder nada.
// Las imágenes que no cambian entre versiones son enlaces duros al mismo
// archivo: para copiar la biblioteca usar `rsync -aH` (o tar) para conservarlos.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const C = require('./config');

class ErrorApi extends Error {
  constructor(estado, mensaje) {
    super(mensaje);
    this.estado = estado;
  }
}
const falla = (estado, mensaje) => {
  throw new ErrorApi(estado, mensaje);
};

// ---------- utilidades ----------

function limpiarNombre(nombre) {
  if (typeof nombre !== 'string') falla(400, 'Nombre inválido');
  const s = nombre
    .normalize('NFC')
    .replace(/[/\\:*?"<>|\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 80)
    .trim();
  if (!s) falla(400, 'Nombre inválido');
  return s;
}

function slug(texto) {
  return (
    texto
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60)
      .replace(/-+$/, '') || 'ficha'
  );
}

function rutaSegura(segmentos) {
  if (!Array.isArray(segmentos)) falla(400, 'Ruta inválida');
  for (const s of segmentos) {
    let limpio;
    try {
      limpio = limpiarNombre(s);
    } catch {
      limpio = null;
    }
    if (s !== limpio) falla(400, 'Ruta inválida');
  }
  const p = path.resolve(C.BIBLIOTECA, ...segmentos);
  if (p !== C.BIBLIOTECA && !p.startsWith(C.BIBLIOTECA + path.sep)) falla(400, 'Ruta inválida');
  return p;
}

const esDirectorio = (p) => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};
const esFicha = (dir) => fs.existsSync(path.join(dir, 'ficha.json'));

function dirCategoria(segmentos) {
  const dir = rutaSegura(segmentos);
  if (!segmentos.length || !esDirectorio(dir) || esFicha(dir)) falla(404, 'La categoría no existe');
  return dir;
}

function leerJson(archivo) {
  return JSON.parse(fs.readFileSync(archivo, 'utf8'));
}

function escribirJson(archivo, datos) {
  const tmp = `${archivo}.${crypto.randomBytes(3).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(datos, null, 2));
  fs.renameSync(tmp, archivo);
}

function nombreLibre(dirPadre, base) {
  let nombre = base;
  for (let n = 2; fs.existsSync(path.join(dirPadre, nombre)); n++) nombre = `${base}-${n}`;
  return nombre;
}

const urlArchivo = (segmentos) => '/archivos/' + segmentos.map(encodeURIComponent).join('/');

// ---------- versiones (X.Y, con Y entre 0 y 9) ----------

function parseVersion(v) {
  const m = /^(\d{1,3})\.(\d)$/.exec(String(v));
  return m ? [Number(m[1]), Number(m[2])] : null;
}
function compararVersion(a, b) {
  const [x, y] = [parseVersion(a), parseVersion(b)];
  return x[0] - y[0] || x[1] - y[1];
}
const versionMayor = (lista) => lista.reduce((m, v) => (compararVersion(v, m) > 0 ? v : m));

// ---------- índice ----------

let cache = null;
let cacheHora = 0;

function invalidar() {
  cache = null;
}

function indice() {
  if (!cache || Date.now() - cacheHora > 5 * 60e3) {
    cache = escanear();
    cacheHora = Date.now();
  }
  return cache;
}

function escanear() {
  fs.mkdirSync(C.BIBLIOTECA, { recursive: true });
  const fichas = [];
  const porId = new Map();

  function recorrer(dir, segmentos) {
    const nodo = { nombre: segmentos.at(-1) || '', ruta: segmentos, hijos: [], total: 0 };
    let entradas = [];
    try {
      entradas = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return nodo;
    }
    entradas.sort((a, b) => a.name.localeCompare(b.name, 'es'));
    for (const e of entradas) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue;
      const sub = path.join(dir, e.name);
      const subSeg = [...segmentos, e.name];
      if (esFicha(sub)) {
        if (!segmentos.length) continue; // las fichas viven dentro de una categoría
        const resumen = cargarResumen(sub, subSeg);
        if (resumen && !porId.has(resumen.id)) {
          fichas.push(resumen);
          porId.set(resumen.id, { dir: sub, segmentos: subSeg });
          nodo.total++;
        }
      } else if (subSeg.length <= C.MAX_NIVELES) {
        const hijo = recorrer(sub, subSeg);
        nodo.hijos.push(hijo);
        nodo.total += hijo.total;
      }
    }
    return nodo;
  }

  const raiz = recorrer(C.BIBLIOTECA, []);
  return { arbol: raiz.hijos, fichas, porId };
}

function cargarResumen(dir, segmentos) {
  try {
    const f = leerJson(path.join(dir, 'ficha.json'));
    const d = leerJson(path.join(dir, `v${f.versionActual}`, 'datos.json'));
    return {
      id: f.id,
      nombre: d.nombre,
      version: f.versionActual,
      fecha: d.fecha,
      autor: d.autor,
      link: d.link || '',
      tags: d.tags || [],
      categoria: segmentos.slice(0, -1),
      texto: (d.pasos || []).map((p) => p.texto || '').join('\n'),
      pasos: (d.pasos || []).length,
      pdf: urlArchivo([...segmentos, `v${f.versionActual}`, d.pdf]),
      versiones: f.versiones.length,
      actualizado: f.actualizado,
    };
  } catch (e) {
    console.warn(`Ficha ilegible en ${dir}: ${e.message}`);
    return null;
  }
}

function ubicar(id) {
  let u = indice().porId.get(id);
  if (!u || !esFicha(u.dir)) {
    invalidar(); // la carpeta pudo moverse por fuera de la wiki
    u = indice().porId.get(id);
  }
  if (!u) falla(404, 'El procedimiento no existe');
  return u;
}

// ---------- validación de datos enviados por el generador ----------

function texto(valor, max, campo, requerido = true) {
  if (valor == null || valor === '') {
    if (requerido) falla(400, `Falta ${campo}`);
    return '';
  }
  if (typeof valor !== 'string') falla(400, `${campo} inválido`);
  const v = valor.trim();
  if (requerido && !v) falla(400, `Falta ${campo}`);
  if (v.length > max) falla(400, `${campo} es demasiado largo`);
  return v;
}

const FIRMAS = {
  jpeg: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  png: (b) => b.subarray(0, 4).toString('hex') === '89504e47',
  webp: (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP',
};

function decodificarImagen(url, paso) {
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(typeof url === 'string' ? url : '');
  if (!m) falla(400, `Imagen inválida en el paso ${paso}`);
  const buf = Buffer.from(m[2], 'base64');
  if (!FIRMAS[m[1]](buf) || buf.length > 15 * 1024 * 1024) falla(400, `Imagen inválida en el paso ${paso}`);
  return { ext: m[1] === 'jpeg' ? 'jpg' : m[1], buf };
}

function decodificarPdf(base64) {
  if (typeof base64 !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(base64)) falla(400, 'PDF inválido');
  const buf = Buffer.from(base64, 'base64');
  if (buf.subarray(0, 5).toString() !== '%PDF-') falla(400, 'PDF inválido');
  return buf;
}

function validarDatos(d) {
  if (!d || typeof d !== 'object') falla(400, 'Datos inválidos');
  const nombre = texto(d.nombre, 150, 'el nombre');
  const fecha = texto(d.fecha, 10, 'la fecha');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) falla(400, 'Fecha inválida');
  const version = texto(d.version, 8, 'la versión');
  if (!parseVersion(version)) falla(400, 'Versión inválida: usa el formato X.Y (Y entre 0 y 9)');
  const autor = texto(d.autor, 80, '"Elaborado por"');
  const link = texto(d.link, 500, 'el link', false);
  if (link && !/^https?:\/\/[^\s]+$/i.test(link)) falla(400, 'El link debe comenzar con http:// o https://');

  if (d.tags != null && !Array.isArray(d.tags)) falla(400, 'Tags inválidos');
  const tags = [...new Set((d.tags || []).map((t) => texto(t, 40, 'un tag', false)).filter(Boolean))];
  if (tags.length > 30) falla(400, 'Máximo 30 tags');

  if (!Array.isArray(d.pasos) || !d.pasos.length) falla(400, 'Agrega al menos un paso');
  if (d.pasos.length > 300) falla(400, 'Demasiados pasos');
  const pasos = d.pasos.map((p, i) => {
    const n = i + 1;
    const t = texto(p && p.texto, 8000, `el texto del paso ${n}`, false);
    const imgs = (p && p.imagenes) || [];
    if (!Array.isArray(imgs) || imgs.length > C.MAX_IMAGENES_PASO) {
      falla(400, `El paso ${n} admite hasta ${C.MAX_IMAGENES_PASO} imágenes`);
    }
    if (!t && !imgs.length) falla(400, `El paso ${n} está vacío`);
    return { texto: t, imagenes: imgs.map((u) => decodificarImagen(u, n)) };
  });
  return { nombre, fecha, version, autor, link, tags, pasos };
}

// ---------- escritura de versiones ----------

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// Imágenes de una versión anterior indexadas por su hash, para reutilizarlas.
function imagenesPorHash(dirVersion) {
  const mapa = new Map();
  if (!dirVersion) return mapa;
  const dirImg = path.join(dirVersion, 'img');
  let archivos = [];
  try {
    archivos = fs.readdirSync(dirImg);
  } catch {
    return mapa;
  }
  for (const nombre of archivos) {
    const ruta = path.join(dirImg, nombre);
    try {
      mapa.set(sha256(fs.readFileSync(ruta)), ruta);
    } catch {
      /* archivo ilegible: se ignora */
    }
  }
  return mapa;
}

// Si la imagen es idéntica a una de la versión anterior se crea un enlace duro
// (mismo archivo en disco, sin ocupar espacio extra); si no, se escribe.
function guardarImagen(destino, buf, previas) {
  const previa = previas.get(sha256(buf));
  if (previa) {
    try {
      fs.linkSync(previa, destino);
      return;
    } catch {
      /* sistema de archivos sin enlaces duros: se copia */
    }
  }
  fs.writeFileSync(destino, buf);
}

function escribirVersion(dirFicha, d, pdf, usuario, dirAnterior = null) {
  const final = path.join(dirFicha, `v${d.version}`);
  if (fs.existsSync(final)) falla(409, `La versión ${d.version} ya existe`);
  const tmp = path.join(dirFicha, `.tmp-${crypto.randomBytes(4).toString('hex')}`);
  try {
    const previas = imagenesPorHash(dirAnterior);
    fs.mkdirSync(path.join(tmp, 'img'), { recursive: true });
    const pasos = d.pasos.map((p, i) => ({
      texto: p.texto,
      imagenes: p.imagenes.map((img, k) => {
        const nombre = `img/paso${String(i + 1).padStart(2, '0')}-${k + 1}.${img.ext}`;
        guardarImagen(path.join(tmp, nombre), img.buf, previas);
        return nombre;
      }),
    }));
    const archivoPdf = `${slug(d.nombre)}_v${d.version}.pdf`;
    fs.writeFileSync(path.join(tmp, archivoPdf), pdf);
    const registro = {
      nombre: d.nombre,
      fecha: d.fecha,
      version: d.version,
      autor: d.autor,
      link: d.link,
      tags: d.tags,
      pasos,
      pdf: archivoPdf,
      guardadoPor: usuario,
      guardado: new Date().toISOString(),
    };
    escribirJson(path.join(tmp, 'datos.json'), registro);
    fs.renameSync(tmp, final);
    return registro;
  } catch (e) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw e;
  }
}

const entradaVersion = (r) => ({
  version: r.version,
  nombre: r.nombre,
  fecha: r.fecha,
  autor: r.autor,
  usuario: r.guardadoPor,
  guardado: r.guardado,
  pdf: r.pdf,
});

function crearFicha({ categoria, datos, pdf }, usuario) {
  const dirCat = dirCategoria(categoria);
  const d = validarDatos(datos);
  const bufPdf = decodificarPdf(pdf);
  const dir = path.join(dirCat, nombreLibre(dirCat, slug(d.nombre)));
  fs.mkdirSync(dir);
  try {
    const r = escribirVersion(dir, d, bufPdf, usuario);
    const ficha = {
      id: crypto.randomUUID(),
      versionActual: d.version,
      creado: r.guardado,
      actualizado: r.guardado,
      versiones: [entradaVersion(r)],
    };
    escribirJson(path.join(dir, 'ficha.json'), ficha);
    invalidar();
    return { id: ficha.id, version: d.version };
  } catch (e) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw e;
  }
}

function nuevaVersion(id, { datos, pdf }, usuario) {
  const { dir } = ubicar(id);
  const archivo = path.join(dir, 'ficha.json');
  const f = leerJson(archivo);
  const d = validarDatos(datos);
  const bufPdf = decodificarPdf(pdf);
  const mayor = versionMayor(f.versiones.map((v) => v.version));
  if (compararVersion(d.version, mayor) <= 0) falla(400, `La versión debe ser mayor que ${mayor}`);
  const r = escribirVersion(dir, d, bufPdf, usuario, path.join(dir, `v${f.versionActual}`));
  f.versiones.push(entradaVersion(r));
  f.versionActual = d.version;
  f.actualizado = r.guardado;
  escribirJson(archivo, f);
  invalidar();
  return { id, version: d.version };
}

function detalleFicha(id, version) {
  const { dir, segmentos } = ubicar(id);
  const f = leerJson(path.join(dir, 'ficha.json'));
  const v = version || f.versionActual;
  if (!f.versiones.some((x) => x.version === v)) falla(404, 'La versión no existe');
  const datos = leerJson(path.join(dir, `v${v}`, 'datos.json'));
  return {
    id: f.id,
    categoria: segmentos.slice(0, -1),
    versionActual: f.versionActual,
    base: urlArchivo([...segmentos, `v${v}`]) + '/',
    datos,
    versiones: f.versiones
      .map((x) => ({ ...x, url: urlArchivo([...segmentos, `v${x.version}`, x.pdf]) }))
      .sort((a, b) => compararVersion(b.version, a.version)),
  };
}

function moverFicha(id, categoria) {
  const { dir, segmentos } = ubicar(id);
  const dirCat = dirCategoria(categoria);
  if (path.dirname(dir) === dirCat) return { id };
  fs.renameSync(dir, path.join(dirCat, nombreLibre(dirCat, segmentos.at(-1))));
  invalidar();
  return { id };
}

// ---------- papelera ----------

function aPapelera(origen, meta) {
  fs.mkdirSync(C.PAPELERA, { recursive: true, mode: 0o750 });
  const id = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const dest = path.join(C.PAPELERA, id);
  fs.mkdirSync(dest);
  fs.renameSync(origen, path.join(dest, 'contenido'));
  escribirJson(path.join(dest, '_papelera.json'), { ...meta, id, borrado: new Date().toISOString() });
}

function eliminarFicha(id, usuario) {
  const { dir, segmentos } = ubicar(id);
  const f = leerJson(path.join(dir, 'ficha.json'));
  const actual = f.versiones.find((v) => v.version === f.versionActual);
  aPapelera(dir, { tipo: 'ficha', fichaId: id, nombre: actual ? actual.nombre : segmentos.at(-1), origen: segmentos, usuario });
  invalidar();
}

function eliminarVersion(id, version, usuario) {
  const { dir, segmentos } = ubicar(id);
  const archivo = path.join(dir, 'ficha.json');
  const f = leerJson(archivo);
  const i = f.versiones.findIndex((v) => v.version === version);
  if (i < 0) falla(404, 'La versión no existe');
  if (f.versiones.length === 1) falla(400, 'Es la única versión: elimina el procedimiento completo');
  const [entrada] = f.versiones.splice(i, 1);
  aPapelera(path.join(dir, `v${version}`), {
    tipo: 'version',
    fichaId: id,
    version,
    entrada,
    nombre: `${entrada.nombre} v${version}`,
    origen: segmentos,
    usuario,
  });
  f.versionActual = versionMayor(f.versiones.map((v) => v.version));
  escribirJson(archivo, f);
  invalidar();
}

function dirPapelera(id) {
  if (!/^\d+-[a-f0-9]{6}$/.test(String(id))) falla(400, 'Elemento inválido');
  const dir = path.join(C.PAPELERA, id);
  if (!esDirectorio(dir)) falla(404, 'El elemento no existe');
  return dir;
}

function listarPapelera() {
  if (!esDirectorio(C.PAPELERA)) return [];
  return fs
    .readdirSync(C.PAPELERA)
    .map((n) => {
      try {
        return leerJson(path.join(C.PAPELERA, n, '_papelera.json'));
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.borrado.localeCompare(a.borrado));
}

function restaurar(idPapelera) {
  const dir = dirPapelera(idPapelera);
  const meta = leerJson(path.join(dir, '_papelera.json'));
  const contenido = path.join(dir, 'contenido');
  if (meta.tipo === 'ficha') {
    if (indice().porId.has(meta.fichaId)) falla(409, 'El procedimiento ya existe en la biblioteca');
    const padre = meta.origen.slice(0, -1);
    const dirPadre = rutaSegura(padre);
    fs.mkdirSync(dirPadre, { recursive: true });
    fs.renameSync(contenido, path.join(dirPadre, nombreLibre(dirPadre, meta.origen.at(-1))));
  } else {
    let u;
    try {
      u = ubicar(meta.fichaId);
    } catch {
      falla(409, 'El procedimiento original ya no existe: restáuralo primero');
    }
    const archivo = path.join(u.dir, 'ficha.json');
    const f = leerJson(archivo);
    const destino = path.join(u.dir, `v${meta.version}`);
    if (fs.existsSync(destino) || f.versiones.some((v) => v.version === meta.version)) {
      falla(409, `La versión ${meta.version} ya existe en el procedimiento`);
    }
    fs.renameSync(contenido, destino);
    f.versiones.push(meta.entrada);
    f.versiones.sort((a, b) => compararVersion(a.version, b.version));
    f.versionActual = versionMayor(f.versiones.map((v) => v.version));
    escribirJson(archivo, f);
  }
  fs.rmSync(dir, { recursive: true, force: true });
  invalidar();
  return meta;
}

function purgar(idPapelera) {
  fs.rmSync(dirPapelera(idPapelera), { recursive: true, force: true });
}

// ---------- categorías ----------

function crearCategoria(padre, nombre) {
  if (padre.length) dirCategoria(padre);
  const ruta = [...padre, limpiarNombre(nombre)];
  if (ruta.length > C.MAX_NIVELES) {
    falla(400, `Máximo ${C.MAX_NIVELES} niveles (categoría + ${C.MAX_NIVELES - 1} subniveles)`);
  }
  const dir = rutaSegura(ruta);
  if (fs.existsSync(dir)) falla(409, 'Ya existe una categoría con ese nombre');
  fs.mkdirSync(dir, { recursive: true });
  invalidar();
  return { ruta };
}

function renombrarCategoria(ruta, nombre) {
  const dir = dirCategoria(ruta);
  const nueva = [...ruta.slice(0, -1), limpiarNombre(nombre)];
  const destino = rutaSegura(nueva);
  const soloMayusculas = destino.toLowerCase() === dir.toLowerCase();
  if (destino !== dir && fs.existsSync(destino) && !soloMayusculas) falla(409, 'Ya existe una categoría con ese nombre');
  fs.renameSync(dir, destino);
  invalidar();
  return { ruta: nueva };
}

function eliminarCategoria(ruta) {
  const dir = dirCategoria(ruta);
  if (fs.readdirSync(dir).some((n) => !n.startsWith('.'))) falla(409, 'La categoría no está vacía');
  fs.rmSync(dir, { recursive: true, force: true });
  invalidar();
}

module.exports = {
  ErrorApi,
  indice,
  invalidar,
  crearFicha,
  nuevaVersion,
  detalleFicha,
  moverFicha,
  eliminarFicha,
  eliminarVersion,
  listarPapelera,
  restaurar,
  purgar,
  crearCategoria,
  renombrarCategoria,
  eliminarCategoria,
  // expuestos para pruebas
  parseVersion,
  compararVersion,
  slug,
  limpiarNombre,
};
