#!/usr/bin/env node
'use strict';
// Servidor de la Wiki (sin dependencias externas). Caddy hace de proxy inverso
// para /api/* y sirve los archivos estáticos y /archivos/* directamente.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const C = require('./config');
const auth = require('./auth');
const bib = require('./biblioteca');
const { ErrorApi } = bib;

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

// ---------- utilidades HTTP ----------

function responder(res, estado, cuerpo, cabeceras = {}) {
  const json = JSON.stringify(cuerpo);
  res.writeHead(estado, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...cabeceras,
  });
  res.end(json);
}

function leerCookies(req) {
  const cookies = {};
  for (const par of (req.headers.cookie || '').split(';')) {
    const i = par.indexOf('=');
    if (i <= 0) continue;
    try {
      cookies[par.slice(0, i).trim()] = decodeURIComponent(par.slice(i + 1).trim());
    } catch {
      /* cookie de otro sitio con formato inválido: se ignora */
    }
  }
  return cookies;
}

function esHttps(req) {
  if (C.COOKIE_SECURE === '1') return true;
  if (C.COOKIE_SECURE === '0') return false;
  return /https/.test(req.headers['cf-visitor'] || '') || req.headers['x-forwarded-proto'] === 'https';
}

function cookieSesion(req, valor, maxAge) {
  return `wiki_sesion=${valor}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${esHttps(req) ? '; Secure' : ''}`;
}

function ipCliente(req) {
  return req.headers['cf-connecting-ip'] || (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;
}

const LIMITE_PEQUENO = 64 * 1024; // login, categorías, mover… (todo salvo guardar procedimientos)
const muyGrande = (limite) =>
  new ErrorApi(413, limite > LIMITE_PEQUENO ? 'El procedimiento es demasiado grande (máximo 95 MB). Reduce la cantidad o el tamaño de las imágenes.' : 'Petición demasiado grande');

function leerCuerpo(req, limite) {
  return new Promise((resolve, reject) => {
    if (Number(req.headers['content-length']) > limite) {
      req.resume(); // se descarta sin guardarlo en memoria
      return reject(muyGrande(limite));
    }
    const partes = [];
    let total = 0;
    let excedido = false;
    req.on('data', (c) => {
      if (excedido) return;
      total += c.length;
      if (total > limite) {
        excedido = true;
        partes.length = 0;
      } else partes.push(c);
    });
    req.on('end', () => {
      if (excedido) return reject(muyGrande(limite));
      if (!total) return resolve({});
      let datos;
      try {
        datos = JSON.parse(Buffer.concat(partes).toString('utf8'));
      } catch {
        return reject(new ErrorApi(400, 'JSON inválido'));
      }
      if (!datos || typeof datos !== 'object' || Array.isArray(datos)) return reject(new ErrorApi(400, 'JSON inválido'));
      resolve(datos);
    });
    req.on('error', reject);
  });
}

function auditar(usuario, accion, detalle) {
  const linea = `${new Date().toISOString()}\t${usuario}\t${accion}\t${JSON.stringify(detalle)}\n`;
  fs.appendFile(path.join(C.CONFIG, 'auditoria.log'), linea, () => {});
}

// Límite simple de intentos de ingreso: 10 fallos cada 15 minutos por IP.
const intentos = new Map();
function controlarIntentos(ip) {
  const ahora = Date.now();
  const r = intentos.get(ip);
  if (r && ahora - r.desde < 15 * 60e3 && r.n >= 10) {
    throw new ErrorApi(429, 'Demasiados intentos. Espera unos minutos.');
  }
}
function registrarFallo(ip) {
  const ahora = Date.now();
  const r = intentos.get(ip);
  if (!r || ahora - r.desde > 15 * 60e3) intentos.set(ip, { desde: ahora, n: 1 });
  else r.n++;
}

setInterval(() => {
  const ahora = Date.now();
  for (const [ip, r] of intentos) if (ahora - r.desde > 15 * 60e3) intentos.delete(ip);
  auth.limpiarRevocados();
}, 10 * 60e3).unref();

// ---------- rutas de la API ----------

const EDITOR = 'editor';
const ADMIN = 'admin';

const rutas = [
  ['GET', /^\/api\/sesion$/, null, (ctx) => ({ usuario: ctx.usuario })],

  [
    'POST',
    /^\/api\/login$/,
    null,
    async (ctx) => {
      const ip = ipCliente(ctx.req);
      controlarIntentos(ip);
      const usuario = String(ctx.body.usuario || '').trim().toLowerCase().slice(0, 40);
      const u = await auth.verificar(usuario, ctx.body.clave);
      if (!u) {
        registrarFallo(ip);
        throw new ErrorApi(401, 'Usuario o clave incorrectos');
      }
      intentos.delete(ip);
      ctx.cabeceras['Set-Cookie'] = cookieSesion(ctx.req, auth.crearToken(u.usuario), C.SESION_HORAS * 3600);
      auditar(u.usuario, 'login', { ip });
      return { usuario: u };
    },
  ],

  [
    'POST',
    /^\/api\/logout$/,
    null,
    (ctx) => {
      auth.revocar(leerCookies(ctx.req).wiki_sesion);
      ctx.cabeceras['Set-Cookie'] = cookieSesion(ctx.req, '', 0);
      return { ok: true };
    },
  ],

  [
    'GET',
    /^\/api\/biblioteca$/,
    null,
    () => {
      const { arbol, fichas } = bib.indice();
      return { arbol, fichas, maxNiveles: C.MAX_NIVELES };
    },
  ],

  ['GET', /^\/api\/fichas\/([\w-]+)$/, null, (ctx) => bib.detalleFicha(ctx.p[0], ctx.query.get('version'), !!ctx.usuario)],

  [
    'POST',
    /^\/api\/fichas$/,
    EDITOR,
    (ctx) => {
      const r = bib.crearFicha(ctx.body, ctx.usuario.usuario);
      auditar(ctx.usuario.usuario, 'crear-ficha', r);
      return r;
    },
    { cuerpo: C.MAX_BODY },
  ],

  [
    'POST',
    /^\/api\/fichas\/([\w-]+)\/versiones$/,
    EDITOR,
    (ctx) => {
      const r = bib.nuevaVersion(ctx.p[0], ctx.body, ctx.usuario.usuario);
      auditar(ctx.usuario.usuario, 'nueva-version', r);
      return r;
    },
    { cuerpo: C.MAX_BODY },
  ],

  [
    'POST',
    /^\/api\/fichas\/([\w-]+)\/mover$/,
    EDITOR,
    (ctx) => {
      const r = bib.moverFicha(ctx.p[0], ctx.body.categoria);
      auditar(ctx.usuario.usuario, 'mover-ficha', { id: ctx.p[0], categoria: ctx.body.categoria });
      return r;
    },
  ],

  [
    'DELETE',
    /^\/api\/fichas\/([\w-]+)$/,
    ADMIN,
    (ctx) => {
      bib.eliminarFicha(ctx.p[0], ctx.usuario.usuario);
      auditar(ctx.usuario.usuario, 'eliminar-ficha', { id: ctx.p[0] });
      return { ok: true };
    },
  ],

  [
    'DELETE',
    /^\/api\/fichas\/([\w-]+)\/versiones\/(\d{1,3}\.\d)$/,
    ADMIN,
    (ctx) => {
      bib.eliminarVersion(ctx.p[0], ctx.p[1], ctx.usuario.usuario);
      auditar(ctx.usuario.usuario, 'eliminar-version', { id: ctx.p[0], version: ctx.p[1] });
      return { ok: true };
    },
  ],

  [
    'POST',
    /^\/api\/categorias$/,
    EDITOR,
    (ctx) => {
      const r = bib.crearCategoria(ctx.body.padre || [], ctx.body.nombre);
      auditar(ctx.usuario.usuario, 'crear-categoria', r);
      return r;
    },
  ],

  [
    'PUT',
    /^\/api\/categorias$/,
    EDITOR,
    (ctx) => {
      const r = bib.renombrarCategoria(ctx.body.ruta, ctx.body.nombre);
      auditar(ctx.usuario.usuario, 'renombrar-categoria', { de: ctx.body.ruta, a: r.ruta });
      return r;
    },
  ],

  [
    'DELETE',
    /^\/api\/categorias$/,
    ADMIN,
    (ctx) => {
      bib.eliminarCategoria(ctx.body.ruta);
      auditar(ctx.usuario.usuario, 'eliminar-categoria', { ruta: ctx.body.ruta });
      return { ok: true };
    },
  ],

  ['GET', /^\/api\/papelera$/, ADMIN, () => ({ elementos: bib.listarPapelera() })],

  [
    'POST',
    /^\/api\/papelera\/([\w-]+)\/restaurar$/,
    ADMIN,
    (ctx) => {
      const meta = bib.restaurar(ctx.p[0]);
      auditar(ctx.usuario.usuario, 'restaurar', { tipo: meta.tipo, nombre: meta.nombre, reubicado: meta.reubicado });
      return { ok: true, reubicado: meta.reubicado || null };
    },
  ],

  [
    'DELETE',
    /^\/api\/papelera\/([\w-]+)$/,
    ADMIN,
    (ctx) => {
      bib.purgar(ctx.p[0]);
      auditar(ctx.usuario.usuario, 'purgar', { id: ctx.p[0] });
      return { ok: true };
    },
  ],

  [
    'POST',
    /^\/api\/reindexar$/,
    ADMIN,
    () => {
      bib.invalidar();
      return { fichas: bib.indice().fichas.length };
    },
  ],
];

async function manejarApi(req, res, url) {
  const cabeceras = {};
  try {
    let ruta;
    let p;
    for (const r of rutas) {
      if (r[0] !== req.method) continue;
      const m = r[1].exec(url.pathname);
      if (m) {
        ruta = r;
        try {
          p = m.slice(1).map(decodeURIComponent);
        } catch {
          throw new ErrorApi(400, 'Ruta inválida');
        }
        break;
      }
    }
    if (!ruta) throw new ErrorApi(404, 'Ruta no encontrada');

    const usuario = auth.leerToken(leerCookies(req).wiki_sesion);
    const [, , rol, fn, opciones = {}] = ruta;
    if (rol && !usuario) throw new ErrorApi(401, 'Debes ingresar para realizar esta acción');
    if (rol === ADMIN && usuario.rol !== ADMIN) throw new ErrorApi(403, 'Solo el administrador puede realizar esta acción');

    let body = {};
    if (req.method !== 'GET') {
      // Protección CSRF: solo peticiones JSON hechas por la propia aplicación.
      if (req.headers['x-wiki'] !== '1' || !/^application\/json/.test(req.headers['content-type'] || '')) {
        throw new ErrorApi(400, 'Petición inválida');
      }
      body = await leerCuerpo(req, opciones.cuerpo || LIMITE_PEQUENO);
    }
    const resultado = await fn({ req, p, body, usuario, cabeceras, query: url.searchParams });
    responder(res, 200, resultado, cabeceras);
  } catch (e) {
    if (e instanceof ErrorApi) {
      if (e.estado === 413) cabeceras.Connection = 'close';
      return responder(res, e.estado, { error: e.message }, cabeceras);
    }
    console.error(e);
    responder(res, 500, { error: 'Error interno del servidor' }, cabeceras);
  }
}

// ---------- estáticos (solo si no los sirve Caddy) ----------

function servirArchivo(req, res, base, relativa, respaldoSpa) {
  let archivo;
  try {
    archivo = path.resolve(base, '.' + path.posix.normalize('/' + decodeURIComponent(relativa)));
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (archivo !== base && !archivo.startsWith(base + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  fs.stat(archivo, (err, st) => {
    if (!err && st.isDirectory()) return servirArchivo(req, res, base, path.posix.join(relativa, 'index.html'), respaldoSpa);
    if (err || !st.isFile() || path.basename(archivo).startsWith('.')) {
      if (respaldoSpa) return servirArchivo(req, res, base, '/index.html', false);
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('No encontrado');
      return;
    }
    res.writeHead(200, {
      'Content-Type': TIPOS[path.extname(archivo).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-cache',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(archivo).pipe(res);
  });
}

const servidor = http.createServer((req, res) => {
  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Petición inválida');
    return;
  }
  if (url.pathname.startsWith('/api/')) return manejarApi(req, res, url);
  if (!C.SERVIR_ESTATICOS || !['GET', 'HEAD'].includes(req.method)) {
    res.writeHead(404).end();
    return;
  }
  if (url.pathname.startsWith('/archivos/')) {
    if (/\.json$/i.test(url.pathname)) {
      res.writeHead(404).end();
      return;
    }
    return servirArchivo(req, res, C.BIBLIOTECA, url.pathname.slice('/archivos'.length), false);
  }
  servirArchivo(req, res, C.PUBLIC_DIR, url.pathname, true);
});

if (require.main === module) {
  fs.mkdirSync(C.BIBLIOTECA, { recursive: true });
  fs.mkdirSync(C.CONFIG, { recursive: true, mode: 0o700 });
  const usuarios = auth.leerUsuarios();
  for (const u of Object.keys(auth.USUARIOS)) {
    if (!usuarios[u]) console.warn(`⚠ El usuario ${u} no tiene clave. Ejecuta: node server/cli.js clave ${u}`);
  }
  servidor.listen(C.PORT, C.HOST, () => {
    console.log(`Wiki escuchando en http://${C.HOST}:${C.PORT} — datos en ${C.DATA_DIR}`);
  });
}

module.exports = servidor;
